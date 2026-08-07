"""Core types for the history-preserving data pipeline (US20170097950A1)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set


class DatasetType(Enum):
    BASE = "base"
    DERIVED = "derived"
    EXTERNAL = "external"


class DataFormat(Enum):
    CSV = "csv"
    JSON = "json"
    XML = "xml"
    PARQUET = "parquet"
    AVRO = "avro"
    TEXT = "text"
    BINARY = "binary"


class BuildStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    ABORTED = "aborted"


class BuildTrigger(Enum):
    MANUAL = "manual"
    SCHEDULED = "scheduled"
    DEPENDENCY_UPDATE = "dependency_updated"
    PROGRAM_UPDATE = "program_updated"
    QUEUE = "queue_triggered"


@dataclass
class DatasetVersion:
    dataset_name: str
    version_id: str
    created_at: datetime
    created_by: str
    data_format: DataFormat = DataFormat.JSON
    container_ids: List[str] = field(default_factory=list)
    parent_version_id: Optional[str] = None
    is_committed: bool = True
    commit_timestamp: Optional[datetime] = None
    commit_id: Optional[str] = None
    size_bytes: int = 0
    checksum: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    is_archived: bool = False
    lineage_depth: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "version_id": self.version_id,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "data_format": self.data_format.value,
            "container_ids": self.container_ids,
            "parent_version_id": self.parent_version_id,
            "is_committed": self.is_committed,
            "commit_timestamp": (
                self.commit_timestamp.isoformat() if self.commit_timestamp else None
            ),
            "commit_id": self.commit_id,
            "size_bytes": self.size_bytes,
            "checksum": self.checksum,
            "description": self.description,
            "tags": self.tags,
            "is_archived": self.is_archived,
            "lineage_depth": self.lineage_depth,
        }

    def is_derived(self) -> bool:
        return self.lineage_depth > 0


@dataclass
class DerivationProgram:
    program_name: str
    version: str
    code: str
    program_type: str = "python"
    input_datasets: List[str] = field(default_factory=list)
    output_datasets: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    created_by: str = "system"
    description: Optional[str] = None
    parameters: Dict[str, Any] = field(default_factory=dict)
    is_deprecated: bool = False
    deprecation_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "program_name": self.program_name,
            "version": self.version,
            "code": self.code,
            "program_type": self.program_type,
            "input_datasets": self.input_datasets,
            "output_datasets": self.output_datasets,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "description": self.description,
            "parameters": self.parameters,
            "is_deprecated": self.is_deprecated,
            "deprecation_reason": self.deprecation_reason,
        }


@dataclass
class BuildDependency:
    dataset_name: str
    version_id: str
    dependent_dataset: str
    dependent_version: str
    derivation_program_name: str
    derivation_program_version: str
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "version_id": self.version_id,
            "dependent_dataset": self.dependent_dataset,
            "dependent_version": self.dependent_version,
            "derivation_program_name": self.derivation_program_name,
            "derivation_program_version": self.derivation_program_version,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class BuildCatalogEntry:
    dataset_name: str
    dataset_version: str
    derivation_program_name: str
    derivation_program_version: str
    input_dependencies: List[BuildDependency] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    build_duration_seconds: float = 0.0
    build_status: str = "success"
    error_message: Optional[str] = None
    build_trigger: str = "manual"
    output_containers: List[str] = field(default_factory=list)

    def get_all_input_datasets(self) -> Set[str]:
        return {dep.dataset_name for dep in self.input_dependencies}

    def get_dependency_version(self, dataset_name: str) -> Optional[str]:
        for dep in self.input_dependencies:
            if dep.dataset_name == dataset_name:
                return dep.version_id
        return None

    def has_dependency_on(self, dataset_name: str, version_id: str) -> bool:
        return any(
            d.dataset_name == dataset_name and d.version_id == version_id
            for d in self.input_dependencies
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "dataset_version": self.dataset_version,
            "derivation_program_name": self.derivation_program_name,
            "derivation_program_version": self.derivation_program_version,
            "input_dependencies": [d.to_dict() for d in self.input_dependencies],
            "created_at": self.created_at.isoformat(),
            "build_duration_seconds": self.build_duration_seconds,
            "build_status": self.build_status,
            "error_message": self.error_message,
            "build_trigger": self.build_trigger,
            "output_containers": self.output_containers,
        }


@dataclass
class TransactionEntry:
    dataset_name: str
    transaction_id: str
    start_timestamp: datetime
    committed: bool = False
    abort_timestamp: Optional[datetime] = None
    commit_timestamp: Optional[datetime] = None
    commit_identifier: Optional[str] = None
    container_ids: List[str] = field(default_factory=list)
    data_written: List[Any] = field(default_factory=list)
    parent_version_id: Optional[str] = None
    user: str = "system"

    def is_active(self) -> bool:
        return not self.committed and self.abort_timestamp is None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "transaction_id": self.transaction_id,
            "start_timestamp": self.start_timestamp.isoformat(),
            "committed": self.committed,
            "abort_timestamp": (
                self.abort_timestamp.isoformat() if self.abort_timestamp else None
            ),
            "commit_timestamp": (
                self.commit_timestamp.isoformat() if self.commit_timestamp else None
            ),
            "commit_identifier": self.commit_identifier,
            "container_ids": self.container_ids,
            "parent_version_id": self.parent_version_id,
            "user": self.user,
        }


@dataclass
class BuildMessage:
    dataset_name: str
    new_version_id: str
    triggered_at: datetime
    trigger_type: str = "transaction_commit"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "new_version_id": self.new_version_id,
            "triggered_at": self.triggered_at.isoformat(),
            "trigger_type": self.trigger_type,
        }


@dataclass
class DatasetInfo:
    dataset_name: str
    dataset_type: DatasetType
    created_at: datetime
    latest_version_id: Optional[str] = None
    total_versions: int = 0
    total_size_bytes: int = 0
    description: Optional[str] = None
    last_built_at: Optional[datetime] = None
    last_build_status: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "dataset_type": self.dataset_type.value,
            "created_at": self.created_at.isoformat(),
            "latest_version_id": self.latest_version_id,
            "total_versions": self.total_versions,
            "total_size_bytes": self.total_size_bytes,
            "description": self.description,
            "last_built_at": (
                self.last_built_at.isoformat() if self.last_built_at else None
            ),
            "last_build_status": self.last_build_status,
        }
