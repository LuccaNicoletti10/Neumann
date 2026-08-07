"""Execute schema maps by resolving properties via ontology registry."""

from __future__ import annotations

from typing import Any

from ..ontology.exceptions import DefinitionNotFoundError
from ..ontology.models import PropertyTypeDefinition
from ..ontology.registry import OntologyRegistry
from .models import FieldMapping, SchemaMap


class MappingExecutor:
    """Resolve FieldMapping → PropertyTypeDefinition using the ontology."""

    def __init__(self, ontology_registry: OntologyRegistry) -> None:
        self.ontology_registry = ontology_registry

    def resolve_property(
        self,
        schema_map: SchemaMap,
        field: FieldMapping,
        ontology_version_id: str,
    ) -> PropertyTypeDefinition:
        return self.ontology_registry.get_property(
            schema_map.target_object,
            field.target_property,
            ontology_version_id,
        )

    def validate_map(self, schema_map: SchemaMap, ontology_version_id: str) -> list[str]:
        errors: list[str] = []
        try:
            self.ontology_registry.get_object(schema_map.target_object, ontology_version_id)
        except DefinitionNotFoundError as exc:
            errors.append(str(exc))
            return errors

        for field in schema_map.fields:
            try:
                self.resolve_property(schema_map, field, ontology_version_id)
            except DefinitionNotFoundError as exc:
                errors.append(str(exc))

        try:
            self.ontology_registry.get_property(
                schema_map.target_object,
                schema_map.key.target_property,
                ontology_version_id,
            )
        except DefinitionNotFoundError as exc:
            errors.append(f"Key property: {exc}")

        return errors

    def extract_raw(
        self, row: dict[str, Any], field: FieldMapping
    ) -> Any:
        return row.get(field.source_field)
