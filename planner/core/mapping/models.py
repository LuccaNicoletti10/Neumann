"""Schema mapping models — mapping points to ontology properties; no transforms."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class KeyMapping:
    source_field: str
    target_property: str


@dataclass(frozen=True)
class FieldMapping:
    source_field: str
    target_property: str
    target_object: str
    source_required: bool = False
    parser_override: str | None = None
    source_type: str | None = None


@dataclass(frozen=True)
class SchemaMap:
    id: str
    client: str
    source: str
    source_dataset: str
    target_object: str
    key: KeyMapping
    fields: tuple[FieldMapping, ...]
    version: str = "1.0.0"
    metadata: dict[str, Any] = field(default_factory=dict)

    def field_for_source(self, source_field: str) -> FieldMapping | None:
        for f in self.fields:
            if f.source_field == source_field:
                return f
        return None
