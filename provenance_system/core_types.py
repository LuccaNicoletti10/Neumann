"""Core data structures for versioned datasets and provenance."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


class DatasetType(Enum):
    """Types of datasets in the system."""

    BASE = "base"
    DERIVED = "derived"


class DataFormat(Enum):
    """Data format types."""

    CSV = "csv"
    JSON = "json"
    XML = "xml"
    PARQUET = "parquet"
    AVRO = "avro"
    TEXT = "text"
    BINARY = "binary"


@dataclass
class DatasetVersion:
    """Immutable version of a dataset."""

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
        }


@dataclass
class DerivationProgram:
    """Versioned derivation program that transforms input datasets."""

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
        }


@dataclass
class BuildDependency:
    """Dependency of a derived dataset on a specific base version."""

    dataset_name: str
    version_id: str
    dependent_dataset: str
    dependent_version: str
    derivation_program_name: str
    derivation_program_version: str
    created_at: datetime = field(default_factory=datetime.now)

    def is_valid(self, check_existence: bool = False) -> bool:
        if not self.dataset_name or not self.version_id:
            return False
        if not self.dependent_dataset or not self.dependent_version:
            return False
        return True

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
    """Build catalog entry for a derived dataset version."""

    dataset_name: str
    dataset_version: str
    derivation_program_name: str
    derivation_program_version: str
    input_dependencies: List[BuildDependency] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    build_duration_seconds: float = 0.0
    build_status: str = "success"
    error_message: Optional[str] = None

    def get_all_input_datasets(self) -> Set[str]:
        return {dep.dataset_name for dep in self.input_dependencies}

    def get_dependency_version(self, dataset_name: str) -> Optional[str]:
        for dep in self.input_dependencies:
            if dep.dataset_name == dataset_name:
                return dep.version_id
        return None

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
        }


@dataclass
class ProvenanceMetadata:
    """Comprehensive provenance metadata for a dataset version."""

    dataset_name: str
    version_id: str
    dependencies: List[BuildDependency] = field(default_factory=list)
    dependents: List[Tuple[str, str]] = field(default_factory=list)
    derivation_program_name: Optional[str] = None
    derivation_program_version: Optional[str] = None
    is_validated: bool = False
    validation_timestamp: Optional[datetime] = None
    validation_errors: List[str] = field(default_factory=list)
    is_flagged_invalid: bool = False
    flag_reason: Optional[str] = None
    flagged_by: Optional[str] = None
    flagged_at: Optional[datetime] = None

    def is_base_dataset(self) -> bool:
        return not self.derivation_program_name

    def is_derived_dataset(self) -> bool:
        return bool(self.derivation_program_name)
