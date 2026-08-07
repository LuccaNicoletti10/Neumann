"""Ingestion results and context."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..ontology.models import CanonicalObject, ParseResult


@dataclass(frozen=True)
class IngestionContext:
    client: str
    run_id: str
    ontology_version_id: str
    dataset: str
    dry_run: bool = False
    max_error_rate: float = 0.2
    source_ref_field: str | None = None


@dataclass
class FieldIngestionResult:
    source_field: str
    property_name: str
    parse_result: ParseResult


@dataclass
class IngestionResult:
    success: bool
    source_ref: str
    object: CanonicalObject | None = None
    fields: list[FieldIngestionResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    quarantined: bool = False


@dataclass
class BatchIngestionReport:
    total: int = 0
    accepted: int = 0
    quarantined: int = 0
    results: list[IngestionResult] = field(default_factory=list)
    aborted: bool = False
    abort_reason: str | None = None

    @property
    def error_rate(self) -> float:
        if self.total == 0:
            return 0.0
        return self.quarantined / self.total
