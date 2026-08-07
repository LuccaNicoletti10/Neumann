"""Immutable storage for versioned datasets."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
import hashlib
import json
import uuid

from .core_types import (
    DataFormat,
    DatasetType,
    DatasetVersion,
    ProvenanceMetadata,
)


class DataLake:
    """Immutable storage for versioned datasets with container references."""

    def __init__(self) -> None:
        self._versions: Dict[str, Dict[str, DatasetVersion]] = {}
        self._dataset_versions: Dict[str, List[DatasetVersion]] = {}
        self._containers: Dict[str, Any] = {}
        self._container_metadata: Dict[str, Dict[str, Any]] = {}
        self._delta_parents: Dict[str, str] = {}
        self._provenance: Dict[str, Dict[str, ProvenanceMetadata]] = {}
        self._dataset_types: Dict[str, DatasetType] = {}

    def create_dataset(self, dataset_name: str, dataset_type: DatasetType) -> bool:
        if dataset_name in self._dataset_types:
            return False
        self._dataset_types[dataset_name] = dataset_type
        self._dataset_versions.setdefault(dataset_name, [])
        self._versions.setdefault(dataset_name, {})
        self._provenance.setdefault(dataset_name, {})
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
    ) -> DatasetVersion:
        if dataset_name not in self._dataset_types:
            self.create_dataset(dataset_name, DatasetType.BASE)

        version_id = self._generate_version_id(dataset_name)
        container_id = f"cont_{dataset_name}_{version_id}_{uuid.uuid4().hex[:8]}"
        self._containers[container_id] = data
        checksum = self._calculate_checksum(data)

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
            size_bytes=self._calculate_size(data),
            checksum=checksum,
            description=description,
            tags=tags or [],
        )

        self._versions.setdefault(dataset_name, {})[version_id] = version
        self._dataset_versions.setdefault(dataset_name, []).append(version)
        self._container_metadata[container_id] = {
            "dataset_name": dataset_name,
            "version_id": version_id,
            "created_at": datetime.now(),
            "size_bytes": version.size_bytes,
            "checksum": checksum,
        }
        self._provenance.setdefault(dataset_name, {})[version_id] = ProvenanceMetadata(
            dataset_name=dataset_name,
            version_id=version_id,
        )
        return version

    def store_delta_version(
        self,
        dataset_name: str,
        delta_data: Dict[str, Any],
        base_version_id: str,
        created_by: str = "system",
        description: Optional[str] = None,
    ) -> DatasetVersion:
        base_version = self.get_version(dataset_name, base_version_id)
        if not base_version:
            raise ValueError(
                f"Base version {base_version_id} not found for dataset {dataset_name}"
            )

        version = self.store_version(
            dataset_name=dataset_name,
            data=delta_data,
            created_by=created_by,
            parent_version_id=base_version_id,
            description=description or f"Delta from {base_version_id}",
        )
        self._delta_parents[version.version_id] = base_version_id
        return version

    def _generate_version_id(self, dataset_name: str) -> str:
        count = len(self._dataset_versions.get(dataset_name, [])) + 1
        return f"v{count:04d}"

    def _calculate_checksum(self, data: Any) -> str:
        data_str = json.dumps(data, sort_keys=True, default=str) if not isinstance(data, str) else data
        return hashlib.sha256(data_str.encode("utf-8")).hexdigest()[:16]

    def _calculate_size(self, data: Any) -> int:
        data_str = json.dumps(data, sort_keys=True, default=str) if not isinstance(data, str) else data
        return len(data_str.encode("utf-8"))

    def get_version(self, dataset_name: str, version_id: str) -> Optional[DatasetVersion]:
        return self._versions.get(dataset_name, {}).get(version_id)

    def get_latest_version(self, dataset_name: str) -> Optional[DatasetVersion]:
        versions = self._dataset_versions.get(dataset_name, [])
        return versions[-1] if versions else None

    def get_all_versions(self, dataset_name: str) -> List[DatasetVersion]:
        return self._dataset_versions.get(dataset_name, [])

    def get_data(self, container_id: str) -> Optional[Any]:
        return self._containers.get(container_id)

    def get_data_for_version(self, dataset_name: str, version_id: str) -> Optional[Any]:
        version = self.get_version(dataset_name, version_id)
        if not version or not version.container_ids:
            return None

        data = None
        for cid in version.container_ids:
            container_data = self._containers.get(cid)
            if data is None:
                data = container_data
            elif isinstance(data, dict) and isinstance(container_data, dict):
                data.update(container_data)
        return data

    def get_delta_parent(self, version_id: str) -> Optional[str]:
        return self._delta_parents.get(version_id)

    def is_delta_version(self, version_id: str) -> bool:
        return version_id in self._delta_parents

    def set_provenance(
        self,
        dataset_name: str,
        version_id: str,
        prov_metadata: ProvenanceMetadata,
    ) -> None:
        self._provenance.setdefault(dataset_name, {})[version_id] = prov_metadata

    def get_provenance(
        self,
        dataset_name: str,
        version_id: str,
    ) -> Optional[ProvenanceMetadata]:
        return self._provenance.get(dataset_name, {}).get(version_id)

    def set_dataset_type(self, dataset_name: str, dataset_type: DatasetType) -> None:
        self._dataset_types[dataset_name] = dataset_type
        self._dataset_versions.setdefault(dataset_name, [])
        self._versions.setdefault(dataset_name, {})
        self._provenance.setdefault(dataset_name, {})

    def get_dataset_type(self, dataset_name: str) -> Optional[DatasetType]:
        return self._dataset_types.get(dataset_name)

    def is_base_dataset(self, dataset_name: str) -> bool:
        return self._dataset_types.get(dataset_name) == DatasetType.BASE

    def is_derived_dataset(self, dataset_name: str) -> bool:
        return self._dataset_types.get(dataset_name) == DatasetType.DERIVED

    def list_datasets(self) -> List[str]:
        return list(self._dataset_types.keys())

    def list_derived_datasets(self) -> List[str]:
        return [
            name
            for name, typ in self._dataset_types.items()
            if typ == DatasetType.DERIVED
        ]

    def list_base_datasets(self) -> List[str]:
        return [
            name
            for name, typ in self._dataset_types.items()
            if typ == DatasetType.BASE
        ]

    def delete_container(self, container_id: str) -> bool:
        if container_id not in self._containers:
            return False
        del self._containers[container_id]
        self._container_metadata.pop(container_id, None)
        return True

    def get_container_metadata(self, container_id: str) -> Optional[Dict[str, Any]]:
        return self._container_metadata.get(container_id)

    def get_all_containers_for_version(
        self,
        dataset_name: str,
        version_id: str,
    ) -> List[str]:
        version = self.get_version(dataset_name, version_id)
        return version.container_ids if version else []

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
            }
            for v in self.get_all_versions(dataset_name)
        ]
