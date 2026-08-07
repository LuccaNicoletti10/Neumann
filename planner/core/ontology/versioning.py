"""Ontology versioning lifecycle: draft → validate → publish → deprecate."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from .compatibility import analyze_compatibility
from .exceptions import ImmutableVersionError, OntologyValidationError
from .models import OntologySnapshot, OntologyVersion, OntologyVersionStatus
from .registry import OntologyRegistry, compute_checksum
from .repository import OntologyRepository


class OntologyVersionService:
    def __init__(
        self,
        registry: OntologyRegistry,
        repository: OntologyRepository,
    ) -> None:
        self.registry = registry
        self.repository = repository

    def create_draft(
        self,
        client: str,
        version: str,
        definition: dict[str, Any],
        *,
        created_by: str = "system",
        parent_version_id: UUID | None = None,
    ) -> OntologyVersion:
        checksum = definition.get("checksum") or "pending"
        ov = OntologyVersion(
            id=uuid4(),
            client=client,
            version=version,
            checksum=checksum,
            status=OntologyVersionStatus.DRAFT,
            parent_version_id=parent_version_id,
            created_at=datetime.now(timezone.utc),
            created_by=created_by,
            definition=definition,
        )
        self.repository.save_version(ov)
        return ov

    def validate(self, version_id: UUID) -> list[str]:
        ov = self.repository.get_version(version_id)
        if ov.status == OntologyVersionStatus.PUBLISHED:
            raise ImmutableVersionError(str(version_id))

        # Structural checks already done at load; re-check transforms exist
        errors: list[str] = []
        props = ov.definition.get("properties", {})
        for prop_id, prop in props.items():
            for parser in prop.get("parsers", []):
                if not self.registry.parser_registry.has(parser.get("transform", "")):
                    errors.append(f"{prop_id}: unknown parser {parser.get('transform')}")
            for validator in prop.get("validators", []):
                if not self.registry.validator_registry.has(validator.get("type", "")):
                    errors.append(f"{prop_id}: unknown validator {validator.get('type')}")

        status = (
            OntologyVersionStatus.REJECTED if errors else OntologyVersionStatus.VALIDATING
        )
        updated = OntologyVersion(
            id=ov.id,
            client=ov.client,
            version=ov.version,
            checksum=ov.checksum,
            status=status,
            parent_version_id=ov.parent_version_id,
            created_at=ov.created_at,
            created_by=ov.created_by,
            published_at=ov.published_at,
            definition=ov.definition,
        )
        self.repository.save_version(updated)
        return errors

    def publish(self, version_id: UUID, snapshot: OntologySnapshot) -> OntologyVersion:
        ov = self.repository.get_version(version_id)
        if ov.status == OntologyVersionStatus.PUBLISHED:
            raise ImmutableVersionError(str(version_id))

        errors = self.validate(version_id)
        if errors:
            raise OntologyValidationError(errors)

        if ov.parent_version_id:
            parent = self.repository.get_version(ov.parent_version_id)
            parent_snap = self.registry.get_snapshot(
                parent.definition.get("snapshot_version_id", "")
            ) if parent.definition.get("snapshot_version_id") else None
            if parent_snap:
                report = analyze_compatibility(parent_snap, snapshot)
                if report.breaking and not ov.definition.get("allow_breaking"):
                    raise OntologyValidationError(report.messages)

        published = OntologyVersion(
            id=ov.id,
            client=ov.client,
            version=ov.version,
            checksum=snapshot.checksum,
            status=OntologyVersionStatus.PUBLISHED,
            parent_version_id=ov.parent_version_id,
            created_at=ov.created_at,
            created_by=ov.created_by,
            published_at=datetime.now(timezone.utc),
            definition={
                **ov.definition,
                "snapshot_version_id": snapshot.version_id,
                "checksum": snapshot.checksum,
            },
        )
        self.repository.save_version(published)
        self.registry.register_snapshot(snapshot, publish=True)

        # Deprecate previous published for client
        for other in self.repository.list_versions(ov.client):
            if (
                other.id != published.id
                and other.status == OntologyVersionStatus.PUBLISHED
            ):
                deprecated = OntologyVersion(
                    id=other.id,
                    client=other.client,
                    version=other.version,
                    checksum=other.checksum,
                    status=OntologyVersionStatus.DEPRECATED,
                    parent_version_id=other.parent_version_id,
                    created_at=other.created_at,
                    created_by=other.created_by,
                    published_at=other.published_at,
                    definition=other.definition,
                )
                self.repository.save_version(deprecated)

        return published

    def rollback(self, client: str, target_version: str) -> OntologyVersion:
        """Re-activate a previous published version without deleting history."""
        versions = self.repository.list_versions(client)
        target = next((v for v in versions if v.version == target_version), None)
        if not target:
            raise OntologyValidationError([f"Version not found: {target_version}"])

        snap_id = target.definition.get("snapshot_version_id")
        if not snap_id:
            raise OntologyValidationError(["Target version has no snapshot"])

        snapshot = self.registry.get_snapshot(snap_id)
        reactivated = OntologyVersion(
            id=target.id,
            client=target.client,
            version=target.version,
            checksum=target.checksum,
            status=OntologyVersionStatus.PUBLISHED,
            parent_version_id=target.parent_version_id,
            created_at=target.created_at,
            created_by=target.created_by,
            published_at=datetime.now(timezone.utc),
            definition=target.definition,
        )
        self.repository.save_version(reactivated)
        self.registry.register_snapshot(snapshot, publish=True)
        return reactivated
