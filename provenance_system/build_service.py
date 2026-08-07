"""Build service for derived datasets and dependency graphs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from .core_types import (
    BuildCatalogEntry,
    BuildDependency,
    DatasetType,
    DerivationProgram,
    ProvenanceMetadata,
)
from .data_lake import DataLake
from .transaction_service import TransactionService


class BuildService:
    """Manages derivation programs, build catalog, and rebuilds."""

    def __init__(
        self,
        data_lake: DataLake,
        transaction_service: TransactionService,
    ) -> None:
        self.data_lake = data_lake
        self.transaction_service = transaction_service
        self.build_catalog: Dict[str, List[BuildCatalogEntry]] = {}
        self.derivation_programs: Dict[str, List[DerivationProgram]] = {}
        self.build_dependency_graph: Dict[str, Set[str]] = {}
        self.reverse_dependency_graph: Dict[str, Set[str]] = {}
        self.dataset_derivation_map: Dict[str, str] = {}
        self._build_queue: List[str] = []

    def register_derivation_program(
        self,
        program_name: str,
        code: str,
        input_datasets: List[str],
        output_datasets: List[str],
        program_type: str = "python",
        description: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> str:
        if program_name not in self.derivation_programs:
            version = "1.0.0"
        else:
            last_version = self.derivation_programs[program_name][-1].version
            parts = last_version.split(".")
            major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2]) + 1
            if patch >= 10:
                patch = 0
                minor += 1
            if minor >= 10:
                minor = 0
                major += 1
            version = f"{major}.{minor}.{patch}"

        prog = DerivationProgram(
            program_name=program_name,
            version=version,
            code=code,
            program_type=program_type,
            input_datasets=input_datasets,
            output_datasets=output_datasets,
            created_at=datetime.now(),
            created_by="system",
            description=description,
            parameters=parameters or {},
        )
        self.derivation_programs.setdefault(program_name, []).append(prog)

        for output_ds in output_datasets:
            self.dataset_derivation_map[output_ds] = program_name
            self.data_lake.set_dataset_type(output_ds, DatasetType.DERIVED)
            self._update_dataset_dependencies(output_ds, input_datasets)

        return version

    def _update_dataset_dependencies(
        self,
        dataset_name: str,
        dependencies: List[str],
    ) -> None:
        old_deps = self.build_dependency_graph.get(dataset_name, set())
        for dep in old_deps:
            reverse = self.reverse_dependency_graph.get(dep, set())
            reverse.discard(dataset_name)

        self.build_dependency_graph[dataset_name] = set(dependencies)
        for dep in dependencies:
            self.reverse_dependency_graph.setdefault(dep, set()).add(dataset_name)

    def define_derived_dataset(self, dataset_name: str, program_name: str) -> bool:
        if program_name not in self.derivation_programs:
            return False
        prog = self.derivation_programs[program_name][-1]
        if dataset_name not in prog.output_datasets:
            return False

        self.dataset_derivation_map[dataset_name] = program_name
        self.data_lake.set_dataset_type(dataset_name, DatasetType.DERIVED)
        self._update_dataset_dependencies(dataset_name, prog.input_datasets)
        return True

    def build_dataset(self, dataset_name: str, force: bool = False) -> Optional[str]:
        if dataset_name not in self.dataset_derivation_map:
            return None

        prog_name = self.dataset_derivation_map[dataset_name]
        prog = self.derivation_programs[prog_name][-1]

        current = self.data_lake.get_latest_version(dataset_name)
        if (
            not force
            and current
            and self._is_up_to_date(dataset_name, current.version_id)
        ):
            return None

        input_data: Dict[str, Any] = {}
        for dep in prog.input_datasets:
            latest = self.data_lake.get_latest_version(dep)
            if not latest:
                if dep in self.dataset_derivation_map:
                    self.build_dataset(dep)
                    latest = self.data_lake.get_latest_version(dep)
                if not latest:
                    return None
            input_data[dep] = self.transaction_service.read_version(
                dep, latest.version_id
            )

        result_data = self._execute_program(prog, input_data)
        if result_data is None:
            return None

        tx_id, success = self.transaction_service.start_transaction(
            dataset_name, "build_service"
        )
        if not success:
            return None

        if self.transaction_service.write_data(tx_id, result_data):
            version_id = self.transaction_service.commit_transaction(tx_id)
            if version_id:
                self._add_build_catalog_entry(
                    dataset_name, version_id, prog_name, prog.version, input_data
                )
                self._update_provenance(dataset_name, version_id, prog, input_data)
                return version_id
        return None

    def _execute_program(
        self,
        prog: DerivationProgram,
        input_data: Dict[str, Any],
    ) -> Any:
        result: Dict[str, Any] = {
            "program": prog.program_name,
            "version": prog.version,
            "inputs": list(input_data.keys()),
            "output": {},
            "execution_time": datetime.now().isoformat(),
        }

        if prog.program_type == "python":
            # Prefer executing registered code when it defines transform().
            local_ns: Dict[str, Any] = {}
            try:
                exec(prog.code, {"__builtins__": {}}, local_ns)
                transform = local_ns.get("transform")
                if callable(transform):
                    result["output"] = transform(input_data)
                else:
                    result["output"] = {
                        "data": "Derived from " + ", ".join(input_data.keys()),
                        "input_summary": {
                            name: (str(data)[:50] + "...")
                            if len(str(data)) > 50
                            else str(data)
                            for name, data in input_data.items()
                        },
                    }
            except Exception:
                result["output"] = {
                    "data": "Derived from " + ", ".join(input_data.keys()),
                    "input_summary": {
                        name: (str(data)[:50] + "...")
                        if len(str(data)) > 50
                        else str(data)
                        for name, data in input_data.items()
                    },
                }
        elif prog.program_type == "sql":
            result["output"]["data"] = "SQL Result from " + ", ".join(input_data.keys())
        elif prog.program_type == "spark":
            result["output"]["data"] = (
                "Spark Result from " + ", ".join(input_data.keys())
            )
        else:
            result["output"]["data"] = "Derived from " + ", ".join(input_data.keys())

        return result

    def _add_build_catalog_entry(
        self,
        dataset_name: str,
        version_id: str,
        prog_name: str,
        prog_version: str,
        inputs: Dict[str, Any],
    ) -> None:
        dependencies = []
        for dep_name in inputs:
            latest = self.data_lake.get_latest_version(dep_name)
            if latest:
                dependencies.append(
                    BuildDependency(
                        dataset_name=dep_name,
                        version_id=latest.version_id,
                        dependent_dataset=dataset_name,
                        dependent_version=version_id,
                        derivation_program_name=prog_name,
                        derivation_program_version=prog_version,
                    )
                )

        entry = BuildCatalogEntry(
            dataset_name=dataset_name,
            dataset_version=version_id,
            derivation_program_name=prog_name,
            derivation_program_version=prog_version,
            input_dependencies=dependencies,
            created_at=datetime.now(),
            build_status="success",
        )
        self.build_catalog.setdefault(dataset_name, []).append(entry)

    def _update_provenance(
        self,
        dataset_name: str,
        version_id: str,
        prog: DerivationProgram,
        inputs: Dict[str, Any],
    ) -> None:
        prov = self.data_lake.get_provenance(dataset_name, version_id)
        if not prov:
            prov = ProvenanceMetadata(dataset_name=dataset_name, version_id=version_id)

        prov.derivation_program_name = prog.program_name
        prov.derivation_program_version = prog.version
        prov.dependencies = []

        for dep_name in inputs:
            latest = self.data_lake.get_latest_version(dep_name)
            if latest:
                prov.dependencies.append(
                    BuildDependency(
                        dataset_name=dep_name,
                        version_id=latest.version_id,
                        dependent_dataset=dataset_name,
                        dependent_version=version_id,
                        derivation_program_name=prog.program_name,
                        derivation_program_version=prog.version,
                    )
                )

        self.data_lake.set_provenance(dataset_name, version_id, prov)

    def _is_up_to_date(self, dataset_name: str, current_version: str) -> bool:
        entry = None
        for e in self.build_catalog.get(dataset_name, []):
            if e.dataset_version == current_version:
                entry = e
                break
        if not entry:
            return False

        for dep in entry.input_dependencies:
            latest = self.data_lake.get_latest_version(dep.dataset_name)
            if latest and latest.version_id != dep.version_id:
                return False

        prog_name = entry.derivation_program_name
        if prog_name in self.derivation_programs:
            latest_prog = self.derivation_programs[prog_name][-1]
            if latest_prog.version != entry.derivation_program_version:
                return False
        return True

    def build_all(self) -> Dict[str, Optional[str]]:
        results: Dict[str, Optional[str]] = {}
        derived_datasets = list(self.dataset_derivation_map.keys())
        built: Set[str] = set()

        while len(built) < len(derived_datasets):
            progress = False
            for ds in derived_datasets:
                if ds in built:
                    continue
                deps = self.build_dependency_graph.get(ds, set())
                if any(dep in derived_datasets and dep not in built for dep in deps):
                    continue
                results[ds] = self.build_dataset(ds)
                built.add(ds)
                progress = True
                break
            if not progress:
                for ds in derived_datasets:
                    if ds not in built:
                        results[ds] = None
                break
        return results

    def get_build_catalog_entry(
        self,
        dataset_name: str,
        version_id: str,
    ) -> Optional[BuildCatalogEntry]:
        for entry in self.build_catalog.get(dataset_name, []):
            if entry.dataset_version == version_id:
                return entry
        return None

    def get_all_build_catalog_entries(
        self,
        dataset_name: str,
    ) -> List[BuildCatalogEntry]:
        return self.build_catalog.get(dataset_name, [])

    def get_build_dependencies(self, dataset_name: str) -> Set[str]:
        return self.build_dependency_graph.get(dataset_name, set())

    def get_reverse_dependencies(self, dataset_name: str) -> Set[str]:
        return self.reverse_dependency_graph.get(dataset_name, set())

    def get_full_dependency_chain(self, dataset_name: str) -> List[str]:
        result: List[str] = []
        visited: Set[str] = set()

        def traverse(ds: str) -> None:
            if ds in visited:
                return
            visited.add(ds)
            for dep in self.build_dependency_graph.get(ds, set()):
                traverse(dep)
            result.append(ds)

        traverse(dataset_name)
        return result

    def get_derivation_program_history(
        self,
        program_name: str,
    ) -> List[DerivationProgram]:
        return self.derivation_programs.get(program_name, [])
