"""Ontology persistence — in-memory repository + SQL DDL for PostgreSQL."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from .exceptions import DefinitionNotFoundError, ImmutableVersionError
from .models import OntologyVersion, OntologyVersionStatus, ParseResult, json_safe


@dataclass
class ParseEvent:
    id: UUID
    client: str
    run_id: str
    source_ref: str
    object_type_id: str
    property_type_id: str
    ontology_version_id: str
    parser_definition_id: str | None
    raw_value_hash: str
    canonical_value_json: Any
    status: str
    errors_json: list[str]
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def hash_raw_value(raw_value: Any) -> str:
    payload = json.dumps(json_safe(raw_value), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class OntologyRepository:
    """In-memory repository implementing the ontology persistence contract."""

    def __init__(self) -> None:
        self._versions: dict[UUID, OntologyVersion] = {}
        self._parse_events: list[ParseEvent] = []

    def save_version(self, version: OntologyVersion) -> None:
        existing = self._versions.get(version.id)
        if existing and existing.status == OntologyVersionStatus.PUBLISHED:
            if version.status == OntologyVersionStatus.PUBLISHED and version.checksum != existing.checksum:
                # allow status transitions recorded at publish time once
                if existing.published_at is not None and version.definition != existing.definition:
                    # Deprecation / republish of *other* versions is fine; editing
                    # an already published definition body is not.
                    if version.version == existing.version and version.definition.get(
                        "snapshot_version_id"
                    ) != existing.definition.get("snapshot_version_id"):
                        raise ImmutableVersionError(str(version.id))
            elif (
                existing.status == OntologyVersionStatus.PUBLISHED
                and version.status not in {
                    OntologyVersionStatus.PUBLISHED,
                    OntologyVersionStatus.DEPRECATED,
                }
            ):
                raise ImmutableVersionError(str(version.id))
        self._versions[version.id] = version

    def get_version(self, version_id: UUID) -> OntologyVersion:
        try:
            return self._versions[version_id]
        except KeyError as exc:
            raise DefinitionNotFoundError("OntologyVersion", str(version_id)) from exc

    def list_versions(self, client: str | None = None) -> list[OntologyVersion]:
        versions = list(self._versions.values())
        if client:
            versions = [v for v in versions if v.client == client]
        return sorted(versions, key=lambda v: v.created_at)

    def record_parse_event(
        self,
        *,
        client: str,
        run_id: str,
        source_ref: str,
        object_type_id: str,
        result: ParseResult,
    ) -> ParseEvent:
        event = ParseEvent(
            id=uuid4(),
            client=client,
            run_id=run_id,
            source_ref=source_ref,
            object_type_id=object_type_id,
            property_type_id=result.property_type_id,
            ontology_version_id=result.ontology_version_id,
            parser_definition_id=result.parser_id,
            raw_value_hash=hash_raw_value(result.raw_value),
            canonical_value_json=json_safe(result.canonical_value),
            status=result.status.value,
            errors_json=list(result.errors),
        )
        self._parse_events.append(event)
        return event

    def list_parse_events(
        self, *, client: str | None = None, run_id: str | None = None
    ) -> list[ParseEvent]:
        events = self._parse_events
        if client:
            events = [e for e in events if e.client == client]
        if run_id:
            events = [e for e in events if e.run_id == run_id]
        return list(events)


POSTGRES_DDL = """
CREATE SCHEMA IF NOT EXISTS ontology;

CREATE TABLE IF NOT EXISTS ontology.versions (
    id UUID PRIMARY KEY,
    client TEXT NOT NULL,
    semantic_version TEXT NOT NULL,
    checksum TEXT NOT NULL,
    status TEXT NOT NULL,
    parent_version_id UUID NULL REFERENCES ontology.versions(id),
    definition_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by TEXT NOT NULL,
    published_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS ontology.object_type_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    object_type_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    base_type_id TEXT NULL,
    key_property_id TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    definition_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology.property_type_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    property_type_id TEXT NOT NULL,
    object_type_id TEXT NOT NULL,
    name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    required BOOLEAN NOT NULL,
    nullable BOOLEAN NOT NULL,
    cardinality TEXT NOT NULL,
    default_value JSONB NULL,
    definition_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology.property_components (
    id UUID PRIMARY KEY,
    property_type_definition_id UUID NOT NULL,
    name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    position INT NOT NULL,
    required BOOLEAN NOT NULL,
    default_value JSONB NULL
);

CREATE TABLE IF NOT EXISTS ontology.parser_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    parser_definition_id TEXT NOT NULL,
    property_type_id TEXT NOT NULL,
    parser_type TEXT NOT NULL,
    priority INT NOT NULL,
    matcher_json JSONB NOT NULL,
    transform_name TEXT NOT NULL,
    args_json JSONB NOT NULL,
    continue_on_invalid BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ontology.parser_subdefinitions (
    id UUID PRIMARY KEY,
    parser_definition_id UUID NOT NULL,
    position INT NOT NULL,
    source_pattern TEXT NOT NULL,
    capture_group TEXT NOT NULL,
    target_component TEXT NOT NULL,
    transform_name TEXT NULL,
    required BOOLEAN NOT NULL,
    default_value JSONB NULL
);

CREATE TABLE IF NOT EXISTS ontology.validator_definitions (
    id UUID PRIMARY KEY,
    ontology_version_id UUID NOT NULL REFERENCES ontology.versions(id),
    validator_definition_id TEXT NOT NULL,
    property_type_id TEXT NOT NULL,
    validator_type TEXT NOT NULL,
    args_json JSONB NOT NULL,
    error_code TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL,
    position INT NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology.parse_events (
    id UUID PRIMARY KEY,
    client TEXT NOT NULL,
    run_id TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    object_type_id TEXT NOT NULL,
    property_type_id TEXT NOT NULL,
    ontology_version_id TEXT NOT NULL,
    parser_definition_id TEXT NULL,
    raw_value_hash TEXT NOT NULL,
    canonical_value_json JSONB NULL,
    status TEXT NOT NULL,
    errors_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE SCHEMA IF NOT EXISTS raw_meta;

CREATE TABLE IF NOT EXISTS raw_meta.quarantine (
    id UUID PRIMARY KEY,
    client TEXT NOT NULL,
    run_id TEXT NOT NULL,
    dataset TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    raw_row_json JSONB NOT NULL,
    error_code TEXT NOT NULL,
    error_path TEXT NULL,
    error_message TEXT NOT NULL,
    ontology_version_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ NULL,
    resolution_comment TEXT NULL
);
"""
