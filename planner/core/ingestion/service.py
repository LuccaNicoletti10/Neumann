"""Ingestion service — single port from raw rows to canonical objects."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Mapping
from uuid import uuid4

from ..mapping.executor import MappingExecutor
from ..mapping.models import SchemaMap
from ..ontology.models import (
    CanonicalObject,
    CanonicalPropertyValue,
    ParseStatus,
)
from ..ontology.parsers.engine import ParserEngine
from ..ontology.registry import OntologyRegistry
from ..ontology.repository import OntologyRepository, hash_raw_value
from .quarantine import QuarantineStore
from .result import (
    BatchIngestionReport,
    FieldIngestionResult,
    IngestionContext,
    IngestionResult,
)


class IngestionService:
    def __init__(
        self,
        ontology_registry: OntologyRegistry,
        parser_engine: ParserEngine,
        mapping_executor: MappingExecutor | None = None,
        repository: OntologyRepository | None = None,
        quarantine: QuarantineStore | None = None,
    ) -> None:
        self.ontology_registry = ontology_registry
        self.parser_engine = parser_engine
        self.mapping_executor = mapping_executor or MappingExecutor(ontology_registry)
        self.repository = repository or OntologyRepository()
        self.quarantine = quarantine or QuarantineStore()

    def ingest_row(
        self,
        source_row: Mapping[str, Any],
        schema_map: SchemaMap,
        context: IngestionContext,
    ) -> IngestionResult:
        row = dict(source_row)
        source_ref = self._source_ref(row, schema_map, context)
        field_results: list[FieldIngestionResult] = []
        errors: list[str] = []
        properties: dict[str, CanonicalPropertyValue] = {}

        # Key first — hard fail
        key_field = next(
            (
                f
                for f in schema_map.fields
                if f.target_property == schema_map.key.target_property
            ),
            None,
        )
        if key_field is None:
            # synthesize from key mapping
            from ..mapping.models import FieldMapping

            key_field = FieldMapping(
                source_field=schema_map.key.source_field,
                target_property=schema_map.key.target_property,
                target_object=schema_map.target_object,
                source_required=True,
            )

        key_raw = row.get(key_field.source_field)
        key_prop = self.mapping_executor.resolve_property(
            schema_map, key_field, context.ontology_version_id
        )
        key_parse = self.parser_engine.parse_property(
            key_prop.id,
            key_raw,
            context.ontology_version_id,
            parser_override=key_field.parser_override,
        )
        self.repository.record_parse_event(
            client=context.client,
            run_id=context.run_id,
            source_ref=source_ref,
            object_type_id=key_prop.object_type,
            result=key_parse,
        )
        field_results.append(
            FieldIngestionResult(
                source_field=key_field.source_field,
                property_name=key_field.target_property,
                parse_result=key_parse,
            )
        )

        if not key_parse.ok:
            msg = f"Key field failed: {key_parse.errors}"
            self.quarantine.add(
                client=context.client,
                run_id=context.run_id,
                dataset=context.dataset,
                source_ref=source_ref,
                raw_row=row,
                error_code="KEY_PARSE_FAILED",
                error_message=msg,
                ontology_version_id=context.ontology_version_id,
                error_path=key_field.source_field,
            )
            return IngestionResult(
                success=False,
                source_ref=source_ref,
                fields=field_results,
                errors=[msg],
                quarantined=True,
            )

        properties[key_prop.id] = CanonicalPropertyValue(
            property_type_id=key_prop.id,
            value=key_parse.canonical_value,
            ontology_version_id=context.ontology_version_id,
            parser_definition_id=key_parse.parser_id,
            source_ref=source_ref,
            raw_value_hash=hash_raw_value(key_raw),
            parsed_at=datetime.now(timezone.utc),
            parser_version=key_parse.parser_version,
        )

        for field in schema_map.fields:
            if field.target_property == schema_map.key.target_property:
                continue

            if field.source_required and field.source_field not in row:
                errors.append(f"Missing required source field: {field.source_field}")
                continue

            prop = self.mapping_executor.resolve_property(
                schema_map, field, context.ontology_version_id
            )
            raw = row.get(field.source_field)
            parse = self.parser_engine.parse_property(
                prop.id,
                raw,
                context.ontology_version_id,
                parser_override=field.parser_override,
            )
            self.repository.record_parse_event(
                client=context.client,
                run_id=context.run_id,
                source_ref=source_ref,
                object_type_id=prop.object_type,
                result=parse,
            )
            field_results.append(
                FieldIngestionResult(
                    source_field=field.source_field,
                    property_name=field.target_property,
                    parse_result=parse,
                )
            )

            if parse.status in {ParseStatus.INVALID, ParseStatus.NO_MATCH}:
                if prop.required or field.source_required:
                    errors.append(
                        f"{field.source_field}→{field.target_property}: {parse.errors}"
                    )
                continue

            if parse.status == ParseStatus.NULL and not prop.required:
                continue

            properties[prop.id] = CanonicalPropertyValue(
                property_type_id=prop.id,
                value=parse.canonical_value,
                ontology_version_id=context.ontology_version_id,
                parser_definition_id=parse.parser_id,
                source_ref=source_ref,
                raw_value_hash=hash_raw_value(raw),
                parsed_at=datetime.now(timezone.utc),
                parser_version=parse.parser_version,
            )

        if errors:
            self.quarantine.add(
                client=context.client,
                run_id=context.run_id,
                dataset=context.dataset,
                source_ref=source_ref,
                raw_row=row,
                error_code="ROW_INVALID",
                error_message="; ".join(errors),
                ontology_version_id=context.ontology_version_id,
            )
            return IngestionResult(
                success=False,
                source_ref=source_ref,
                fields=field_results,
                errors=errors,
                quarantined=True,
            )

        obj_type = self.ontology_registry.get_object(
            schema_map.target_object, context.ontology_version_id
        )
        canonical = CanonicalObject(
            object_type_id=obj_type.id,
            ontology_version_id=context.ontology_version_id,
            key=str(key_parse.canonical_value),
            properties=properties,
            source_ref=source_ref,
        )
        return IngestionResult(
            success=True,
            source_ref=source_ref,
            object=canonical if not context.dry_run else canonical,
            fields=field_results,
            errors=[],
            quarantined=False,
        )

    def ingest_rows(
        self,
        rows: Iterable[Mapping[str, Any]],
        schema_map: SchemaMap,
        context: IngestionContext,
    ) -> BatchIngestionReport:
        report = BatchIngestionReport()
        for row in rows:
            result = self.ingest_row(row, schema_map, context)
            report.total += 1
            report.results.append(result)
            if result.success:
                report.accepted += 1
            else:
                report.quarantined += 1

            if report.error_rate > context.max_error_rate and report.total >= 5:
                report.aborted = True
                report.abort_reason = (
                    f"Error rate {report.error_rate:.0%} exceeded "
                    f"max {context.max_error_rate:.0%}"
                )
                break

        return report

    def _source_ref(
        self,
        row: dict[str, Any],
        schema_map: SchemaMap,
        context: IngestionContext,
    ) -> str:
        if context.source_ref_field and context.source_ref_field in row:
            return str(row[context.source_ref_field])
        key_val = row.get(schema_map.key.source_field, uuid4())
        return f"{context.dataset}:{key_val}"
