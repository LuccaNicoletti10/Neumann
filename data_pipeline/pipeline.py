"""History Preserving Data Pipeline System facade (US20170097950A1)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from .build_service import BuildService
from .core_types import DatasetType
from .data_lake import DataLake
from .transaction_service import TransactionService


class DataPipeline:
    def __init__(self) -> None:
        self.data_lake = DataLake()
        self.transaction_service = TransactionService(self.data_lake)
        self.build_service = BuildService(self.data_lake, self.transaction_service)
        self._is_running = False
        self._started_at = datetime.now()

    def create_dataset(
        self,
        name: str,
        dataset_type: str = "base",
        description: Optional[str] = None,
    ) -> bool:
        dtype = DatasetType.DERIVED if dataset_type == "derived" else DatasetType.BASE
        return self.data_lake.create_dataset(name, dtype, description)

    def write_data(
        self,
        dataset_name: str,
        data: Any,
        user: str = "system",
        description: Optional[str] = None,
    ) -> Optional[str]:
        tx_id, ok = self.transaction_service.start_transaction(dataset_name, user)
        if not ok:
            return None
        if not self.transaction_service.write_data(tx_id, data):
            self.transaction_service.abort_transaction(tx_id)
            return None
        version_id = self.transaction_service.commit_transaction(tx_id)
        if version_id and description:
            version = self.data_lake.get_version(dataset_name, version_id)
            if version:
                version.description = description
        return version_id

    def read_data(
        self, dataset_name: str, version_id: Optional[str] = None
    ) -> Optional[Any]:
        return self.transaction_service.read_version(dataset_name, version_id)

    def get_latest_version(self, dataset_name: str) -> Optional[str]:
        version = self.data_lake.get_latest_version(dataset_name)
        return version.version_id if version else None

    def get_version_history(self, dataset_name: str) -> List[Dict[str, Any]]:
        return self.data_lake.get_version_history(dataset_name)

    def register_program(
        self,
        name: str,
        code: str,
        input_datasets: List[str],
        output_datasets: List[str],
        program_type: str = "python",
        description: Optional[str] = None,
    ) -> str:
        return self.build_service.register_derivation_program(
            name, code, input_datasets, output_datasets, program_type, description
        )

    def define_derived_dataset(self, dataset_name: str, program_name: str) -> bool:
        return self.build_service.define_derived_dataset(dataset_name, program_name)

    def build_dataset(
        self, dataset_name: str, force: bool = False
    ) -> Optional[str]:
        return self.build_service.build_dataset(dataset_name, force)

    def build_all(self) -> Dict[str, Optional[str]]:
        return self.build_service.build_all()

    def process_build_queue(self) -> Dict[str, Optional[str]]:
        return self.build_service.process_build_queue()

    def get_build_dependencies(self, dataset_name: str) -> Set[str]:
        return self.build_service.get_build_dependencies(dataset_name)

    def get_reverse_dependencies(self, dataset_name: str) -> Set[str]:
        return self.build_service.get_reverse_dependencies(dataset_name)

    def get_build_catalog_entry(
        self, dataset_name: str, version_id: str
    ) -> Optional[Dict[str, Any]]:
        entry = self.build_service.get_build_catalog_entry(dataset_name, version_id)
        return entry.to_dict() if entry else None

    def get_full_dependency_chain(self, dataset_name: str) -> List[str]:
        return self.build_service.get_full_dependency_chain(dataset_name)

    def get_dataset_info(self, dataset_name: str) -> Optional[Dict[str, Any]]:
        info = self.data_lake.get_dataset_info(dataset_name)
        return info.to_dict() if info else None

    def list_datasets(self) -> List[str]:
        return self.data_lake.list_datasets()

    def list_derived_datasets(self) -> List[str]:
        return self.data_lake.list_derived_datasets()

    def list_base_datasets(self) -> List[str]:
        return self.data_lake.list_base_datasets()

    def get_total_storage_size(self) -> int:
        return self.data_lake.get_total_size()

    def get_build_dependency_graph(self) -> Dict[str, List[str]]:
        return {
            ds: list(deps)
            for ds, deps in self.build_service.get_build_dependency_graph().items()
        }

    def get_build_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        return self.build_service.get_build_history(limit)

    def get_provenance_for_version(
        self, dataset_name: str, version_id: str
    ) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "dataset": dataset_name,
            "version": version_id,
            "input_datasets": [],
            "derivation_program": None,
            "lineage_depth": 0,
        }
        version = self.data_lake.get_version(dataset_name, version_id)
        if version:
            result["lineage_depth"] = version.lineage_depth
        entry = self.build_service.get_build_catalog_entry(dataset_name, version_id)
        if entry:
            result["derivation_program"] = {
                "name": entry.derivation_program_name,
                "version": entry.derivation_program_version,
            }
            result["input_datasets"] = [
                {"dataset": d.dataset_name, "version": d.version_id}
                for d in entry.input_dependencies
            ]
        return result

    def get_full_provenance(
        self, dataset_name: str, version_id: Optional[str] = None
    ) -> Dict[str, Any]:
        if version_id is None:
            version = self.data_lake.get_latest_version(dataset_name)
            if not version:
                return {}
            version_id = version.version_id
        return {
            "target": {"dataset": dataset_name, "version": version_id},
            "provenance_tree": self._build_provenance_tree(dataset_name, version_id),
        }

    def _build_provenance_tree(
        self, dataset_name: str, version_id: str
    ) -> Dict[str, Any]:
        node: Dict[str, Any] = {
            "dataset": dataset_name,
            "version": version_id,
            "dependencies": [],
        }
        entry = self.build_service.get_build_catalog_entry(dataset_name, version_id)
        if entry:
            for dep in entry.input_dependencies:
                node["dependencies"].append(
                    self._build_provenance_tree(dep.dataset_name, dep.version_id)
                )
        return node

    def get_version_lineage(
        self, dataset_name: str, version_id: str
    ) -> List[Dict[str, str]]:
        lineage: List[Dict[str, str]] = []
        current_ds, current_ver = dataset_name, version_id
        while True:
            lineage.append({"dataset": current_ds, "version": current_ver})
            entry = self.build_service.get_build_catalog_entry(current_ds, current_ver)
            if not entry or not entry.input_dependencies:
                break
            dep = entry.input_dependencies[0]
            current_ds, current_ver = dep.dataset_name, dep.version_id
        lineage.reverse()
        return lineage

    def compare_versions(
        self, dataset_name: str, version_a: str, version_b: str
    ) -> Dict[str, Any]:
        v_a = self.data_lake.get_version(dataset_name, version_a)
        v_b = self.data_lake.get_version(dataset_name, version_b)
        if not v_a or not v_b:
            return {"error": "Version not found"}
        entry_a = self.build_service.get_build_catalog_entry(dataset_name, version_a)
        entry_b = self.build_service.get_build_catalog_entry(dataset_name, version_b)
        deps_a = (
            {d.dataset_name for d in entry_a.input_dependencies} if entry_a else set()
        )
        deps_b = (
            {d.dataset_name for d in entry_b.input_dependencies} if entry_b else set()
        )
        return {
            "dataset": dataset_name,
            "version_a": {
                "id": version_a,
                "created_at": v_a.created_at.isoformat(),
                "created_by": v_a.created_by,
                "size_bytes": v_a.size_bytes,
                "is_derived": entry_a is not None,
                "lineage_depth": v_a.lineage_depth,
                "dependencies": list(deps_a),
            },
            "version_b": {
                "id": version_b,
                "created_at": v_b.created_at.isoformat(),
                "created_by": v_b.created_by,
                "size_bytes": v_b.size_bytes,
                "is_derived": entry_b is not None,
                "lineage_depth": v_b.lineage_depth,
                "dependencies": list(deps_b),
            },
            "comparison": {
                "same_size": v_a.size_bytes == v_b.size_bytes,
                "same_creator": v_a.created_by == v_b.created_by,
                "same_lineage_depth": v_a.lineage_depth == v_b.lineage_depth,
                "same_dependencies": deps_a == deps_b if entry_a and entry_b else None,
            },
        }

    def start(self) -> None:
        self._is_running = True
        self._started_at = datetime.now()

    def stop(self) -> None:
        self._is_running = False

    def is_running(self) -> bool:
        return self._is_running

    def get_uptime(self) -> float:
        if not self._is_running:
            return 0.0
        return (datetime.now() - self._started_at).total_seconds()

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self._is_running,
            "started_at": self._started_at.isoformat(),
            "uptime_seconds": self.get_uptime(),
            "total_datasets": len(self.list_datasets()),
            "total_versions": sum(
                len(self.data_lake.get_all_versions(ds)) for ds in self.list_datasets()
            ),
            "total_size_bytes": self.get_total_storage_size(),
            "pending_builds": len(self.build_service._build_queue),
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.get_status(),
            "datasets": {
                ds: {
                    "info": self.get_dataset_info(ds),
                    "versions": self.get_version_history(ds),
                    "build_catalog": [
                        e.to_dict()
                        for e in self.build_service.get_all_build_catalog_entries(ds)
                    ],
                }
                for ds in self.list_datasets()
            },
            "derivation_programs": {
                prog: [p.to_dict() for p in hist]
                for prog, hist in self.build_service.derivation_programs.items()
            },
            "dependency_graph": self.get_build_dependency_graph(),
            "build_history": self.get_build_history(50),
        }
