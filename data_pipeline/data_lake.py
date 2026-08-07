"""Immutable versioned storage (Data Lake) for US20170097950A1."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
import hashlib
import json
import uuid

from .core_types import (
    BuildCatalogEntry,
    DataFormat,
    DatasetInfo,
    DatasetType,
    DatasetVersion,
    TransactionEntry,
)


class DataLake:
    def __init__(self) -> None:
        self._versions: Dict[str, Dict[str, DatasetVersion]] = {}
        self._dataset_versions: Dict[str, List[DatasetVersion]] = {}
        self._containers: Dict[str, Any] = {}
        self._container_metadata: Dict[str, Dict[str, Any]] = {}
        self._delta_parents: Dict[str, str] = {}
        self._dataset_types: Dict[str, DatasetType] = {}
        self._dataset_info: Dict[str, DatasetInfo] = {}
        self._build_catalog: Dict[str, List[BuildCatalogEntry]] = {}
        self._transactions: Dict[str, TransactionEntry] = {}
        self._cache: Dict[str, Any] = {}
        self._cache_max_size = 100

    def create_dataset(
        self,
        dataset_name: str,
        dataset_type: DatasetType = DatasetType.BASE,
        description: Optional[str] = None,
    ) -> bool:
        if dataset_name in self._dataset_types:
            return False
        self._dataset_types[dataset_name] = dataset_type
        self._dataset_versions.setdefault(dataset_name, [])
        self._versions.setdefault(dataset_name, {})
        self._dataset_info[dataset_name] = DatasetInfo(
            dataset_name=dataset_name,
            dataset_type=dataset_type,
            created_at=datetime.now(),
            description=description,
        )
        return True

    def store_version(
        self,
        dataset_name: str,
        data: Any,
        created_by: str = "system",
        parent_version_id: Optional[str] = None,
        data_format: DataFormat = DataFormat.JSON,
        description: Optional[str] = None,
        tags: Optional[List[str]] = None,
        use_delta: bool = False,
        lineage_depth: int = 0,
    ) -> DatasetVersion:
        if dataset_name not in self._dataset_types:
            self.create_dataset(dataset_name, DatasetType.BASE)

        version_id = self._generate_version_id(dataset_name)
        data_to_store = data
        if use_delta and parent_version_id:
            parent_data = self.get_data_for_version(dataset_name, parent_version_id)
            if parent_data is not None:
                data_to_store = self._compute_delta(parent_data, data)

        if parent_version_id:
            parent = self.get_version(dataset_name, parent_version_id)
            if parent:
                lineage_depth = parent.lineage_depth + 1

        container_id = f"cont_{dataset_name}_{version_id}_{uuid.uuid4().hex[:8]}"
        self._containers[container_id] = data_to_store
        checksum = self._calculate_checksum(data_to_store)
        size = self._calculate_size(data_to_store)

        version = DatasetVersion(
            dataset_name=dataset_name,
            version_id=version_id,
            created_at=datetime.now(),
            created_by=created_by,
            data_format=data_format,
            container_ids=[container_id],
            parent_version_id=parent_version_id,
            is_committed=True,
            commit_timestamp=datetime.now(),
            commit_id=version_id,
            size_bytes=size,
            checksum=checksum,
            description=description,
            tags=tags or [],
            lineage_depth=lineage_depth,
        )

        self._versions.setdefault(dataset_name, {})[version_id] = version
        self._dataset_versions.setdefault(dataset_name, []).append(version)
        self._container_metadata[container_id] = {
            "dataset_name": dataset_name,
            "version_id": version_id,
            "created_at": datetime.now().isoformat(),
            "size_bytes": size,
            "checksum": checksum,
            "is_delta": use_delta and parent_version_id is not None,
            "base_version": parent_version_id if use_delta else None,
        }

        info = self._dataset_info.get(dataset_name)
        if info:
            info.total_versions += 1
            info.latest_version_id = version_id
            info.total_size_bytes += size

        if use_delta and parent_version_id:
            self._delta_parents[version_id] = parent_version_id

        if len(self._cache) > self._cache_max_size:
            self._cache.clear()
        return version

    def _compute_delta(self, base_data: Any, new_data: Any) -> Dict[str, Any]:
        if isinstance(base_data, dict) and isinstance(new_data, dict):
            delta: Dict[str, Any] = {
                "type": "dict_delta",
                "base_checksum": self._calculate_checksum(base_data),
                "added": {},
                "removed": [],
                "modified": {},
                "unchanged": [],
            }
            for key in set(base_data) | set(new_data):
                if key not in base_data:
                    delta["added"][key] = new_data[key]
                elif key not in new_data:
                    delta["removed"].append(key)
                elif base_data[key] != new_data[key]:
                    delta["modified"][key] = {
                        "old": base_data[key],
                        "new": new_data[key],
                    }
                else:
                    delta["unchanged"].append(key)
            return delta
        if isinstance(base_data, list) and isinstance(new_data, list):
            return {
                "type": "list_delta",
                "base_checksum": self._calculate_checksum(base_data),
                "base_length": len(base_data),
                "new_data": new_data,
            }
        return new_data

    def _apply_delta(self, base_data: Any, delta_data: Dict[str, Any]) -> Any:
        delta_type = delta_data.get("type")
        if delta_type == "dict_delta" and isinstance(base_data, dict):
            result = dict(base_data)
            for key in delta_data.get("removed", []):
                result.pop(key, None)
            result.update(delta_data.get("added", {}))
            for key, changes in delta_data.get("modified", {}).items():
                result[key] = changes.get("new")
            return result
        if delta_type == "list_delta":
            return delta_data.get("new_data", base_data)
        return delta_data

    def _generate_version_id(self, dataset_name: str) -> str:
        return f"v{len(self._dataset_versions.get(dataset_name, [])) + 1:04d}"

    def _calculate_checksum(self, data: Any) -> str:
        try:
            data_str = json.dumps(data, sort_keys=True, default=str)
        except Exception:
            data_str = str(data)
        return hashlib.sha256(data_str.encode("utf-8")).hexdigest()[:16]

    def _calculate_size(self, data: Any) -> int:
        try:
            data_str = json.dumps(data, sort_keys=True, default=str)
        except Exception:
            data_str = str(data)
        return len(data_str.encode("utf-8"))

    def get_version(self, dataset_name: str, version_id: str) -> Optional[DatasetVersion]:
        return self._versions.get(dataset_name, {}).get(version_id)

    def get_latest_version(self, dataset_name: str) -> Optional[DatasetVersion]:
        versions = self._dataset_versions.get(dataset_name, [])
        return versions[-1] if versions else None

    def get_previous_version(
        self, dataset_name: str, version_id: str
    ) -> Optional[DatasetVersion]:
        versions = self._dataset_versions.get(dataset_name, [])
        for i, v in enumerate(versions):
            if v.version_id == version_id and i > 0:
                return versions[i - 1]
        return None

    def get_all_versions(self, dataset_name: str) -> List[DatasetVersion]:
        return self._dataset_versions.get(dataset_name, [])

    def get_data(self, container_id: str) -> Optional[Any]:
        return self._containers.get(container_id)

    def get_data_for_version(
        self, dataset_name: str, version_id: str
    ) -> Optional[Any]:
        cache_key = f"{dataset_name}:{version_id}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        version = self.get_version(dataset_name, version_id)
        if not version:
            return None

        if version_id in self._delta_parents:
            base_data = self.get_data_for_version(
                dataset_name, self._delta_parents[version_id]
            )
            delta_data = (
                self._containers.get(version.container_ids[0])
                if version.container_ids
                else None
            )
            if base_data is not None and isinstance(delta_data, dict):
                reconstructed = self._apply_delta(base_data, delta_data)
                self._cache[cache_key] = reconstructed
                return reconstructed

        data = None
        if version.container_ids:
            if len(version.container_ids) == 1:
                data = self._containers.get(version.container_ids[0])
            else:
                data = []
                for cid in version.container_ids:
                    d = self._containers.get(cid)
                    if isinstance(d, list):
                        data.extend(d)
                    elif isinstance(d, dict):
                        data = d if not isinstance(data, dict) else {**data, **d}
        self._cache[cache_key] = data
        return data

    def get_delta_parent(self, version_id: str) -> Optional[str]:
        return self._delta_parents.get(version_id)

    def is_delta_version(self, version_id: str) -> bool:
        return version_id in self._delta_parents

    def get_dataset_type(self, dataset_name: str) -> Optional[DatasetType]:
        return self._dataset_types.get(dataset_name)

    def set_dataset_type(self, dataset_name: str, dataset_type: DatasetType) -> None:
        self._dataset_types[dataset_name] = dataset_type
        self._dataset_versions.setdefault(dataset_name, [])
        self._versions.setdefault(dataset_name, {})
        if dataset_name not in self._dataset_info:
            self._dataset_info[dataset_name] = DatasetInfo(
                dataset_name=dataset_name,
                dataset_type=dataset_type,
                created_at=datetime.now(),
            )
        else:
            self._dataset_info[dataset_name].dataset_type = dataset_type

    def is_base_dataset(self, dataset_name: str) -> bool:
        return self._dataset_types.get(dataset_name) == DatasetType.BASE

    def is_derived_dataset(self, dataset_name: str) -> bool:
        return self._dataset_types.get(dataset_name) == DatasetType.DERIVED

    def list_datasets(self) -> List[str]:
        return list(self._dataset_types.keys())

    def list_derived_datasets(self) -> List[str]:
        return [n for n, t in self._dataset_types.items() if t == DatasetType.DERIVED]

    def list_base_datasets(self) -> List[str]:
        return [
            n
            for n, t in self._dataset_types.items()
            if t in (DatasetType.BASE, DatasetType.EXTERNAL)
        ]

    def get_dataset_info(self, dataset_name: str) -> Optional[DatasetInfo]:
        info = self._dataset_info.get(dataset_name)
        if info:
            latest = self.get_latest_version(dataset_name)
            info.latest_version_id = latest.version_id if latest else None
            info.total_versions = len(self._dataset_versions.get(dataset_name, []))
        return info

    def get_version_history(self, dataset_name: str) -> List[Dict[str, Any]]:
        return [
            {
                "version_id": v.version_id,
                "created_at": v.created_at.isoformat(),
                "created_by": v.created_by,
                "parent_version_id": v.parent_version_id,
                "size_bytes": v.size_bytes,
                "checksum": v.checksum,
                "description": v.description,
                "is_delta": self.is_delta_version(v.version_id),
                "lineage_depth": v.lineage_depth,
            }
            for v in self.get_all_versions(dataset_name)
        ]

    def get_total_size(self) -> int:
        return sum(v.size_bytes for vs in self._dataset_versions.values() for v in vs)

    def add_build_catalog_entry(self, entry: BuildCatalogEntry) -> None:
        self._build_catalog.setdefault(entry.dataset_name, []).append(entry)

    def get_build_catalog_entry(
        self, dataset_name: str, version_id: str
    ) -> Optional[BuildCatalogEntry]:
        for entry in self._build_catalog.get(dataset_name, []):
            if entry.dataset_version == version_id:
                return entry
        return None

    def get_build_catalog(self, dataset_name: str) -> List[BuildCatalogEntry]:
        return self._build_catalog.get(dataset_name, [])

    def delete_container(self, container_id: str) -> bool:
        if container_id not in self._containers:
            return False
        del self._containers[container_id]
        self._container_metadata.pop(container_id, None)
        return True
