"""Quarantine store for invalid ingestion rows."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID, uuid4


class QuarantineStatus(Enum):
    OPEN = "open"
    IGNORED = "ignored"
    CORRECTED = "corrected"
    REPROCESSED = "reprocessed"


@dataclass
class QuarantineRecord:
    id: UUID
    client: str
    run_id: str
    dataset: str
    source_ref: str
    raw_row: dict[str, Any]
    error_code: str
    error_path: str | None
    error_message: str
    ontology_version_id: str
    status: QuarantineStatus = QuarantineStatus.OPEN
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: datetime | None = None
    resolution_comment: str | None = None


class QuarantineStore:
    def __init__(self) -> None:
        self._records: list[QuarantineRecord] = []

    def add(
        self,
        *,
        client: str,
        run_id: str,
        dataset: str,
        source_ref: str,
        raw_row: dict[str, Any],
        error_code: str,
        error_message: str,
        ontology_version_id: str,
        error_path: str | None = None,
    ) -> QuarantineRecord:
        record = QuarantineRecord(
            id=uuid4(),
            client=client,
            run_id=run_id,
            dataset=dataset,
            source_ref=source_ref,
            raw_row=dict(raw_row),
            error_code=error_code,
            error_path=error_path,
            error_message=error_message,
            ontology_version_id=ontology_version_id,
        )
        self._records.append(record)
        return record

    def list(
        self,
        *,
        client: str | None = None,
        dataset: str | None = None,
        status: QuarantineStatus | None = QuarantineStatus.OPEN,
    ) -> list[QuarantineRecord]:
        records = self._records
        if client:
            records = [r for r in records if r.client == client]
        if dataset:
            records = [r for r in records if r.dataset == dataset]
        if status:
            records = [r for r in records if r.status == status]
        return list(records)

    def resolve(
        self,
        record_id: UUID,
        *,
        status: QuarantineStatus,
        comment: str | None = None,
    ) -> QuarantineRecord:
        for record in self._records:
            if record.id == record_id:
                record.status = status
                record.resolved_at = datetime.now(timezone.utc)
                record.resolution_comment = comment
                return record
        raise KeyError(str(record_id))
