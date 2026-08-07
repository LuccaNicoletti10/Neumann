"""Schema mapping between data sources and ontology."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import json


@dataclass
class FieldMapping:
    """Maps a data source field to an ontology property."""

    source_field: str
    target_property: str
    target_object: str
    transformation: Optional[str] = None
    default_value: Optional[Any] = None


@dataclass
class ObjectMapping:
    """Maps a data source to an ontology object."""

    source_type: str
    target_object: str
    field_mappings: List[FieldMapping] = field(default_factory=list)
    filter_condition: Optional[str] = None


class SchemaMap:
    """Manages mappings between data sources and ontology."""

    def __init__(self) -> None:
        self.object_mappings: Dict[str, ObjectMapping] = {}
        self.source_schemas: Dict[str, Dict[str, Any]] = {}

    def add_object_mapping(self, mapping: ObjectMapping) -> None:
        """Add an object mapping."""
        key = f"{mapping.source_type}_{mapping.target_object}"
        self.object_mappings[key] = mapping

    def add_field_mapping(
        self,
        source_type: str,
        target_object: str,
        field_mapping: FieldMapping,
    ) -> None:
        """Add a field mapping to an existing object mapping."""
        key = f"{source_type}_{target_object}"
        if key in self.object_mappings:
            self.object_mappings[key].field_mappings.append(field_mapping)
        else:
            obj_mapping = ObjectMapping(source_type, target_object, [field_mapping])
            self.object_mappings[key] = obj_mapping

    def get_mapping_for_source(
        self,
        source_type: str,
        target_object: Optional[str] = None,
    ) -> List[ObjectMapping]:
        """Get all mappings for a source type."""
        result = []
        for mapping in self.object_mappings.values():
            if mapping.source_type == source_type:
                if target_object is None or mapping.target_object == target_object:
                    result.append(mapping)
        return result

    def get_field_mappings(
        self,
        source_type: str,
        target_object: str,
    ) -> List[FieldMapping]:
        """Get field mappings for a specific source-object combination."""
        key = f"{source_type}_{target_object}"
        if key in self.object_mappings:
            return self.object_mappings[key].field_mappings
        return []

    def to_dict(self) -> Dict[str, Any]:
        """Convert schema map to dictionary."""
        return {
            "object_mappings": [
                {
                    "source_type": m.source_type,
                    "target_object": m.target_object,
                    "filter_condition": m.filter_condition,
                    "field_mappings": [
                        {
                            "source_field": f.source_field,
                            "target_property": f.target_property,
                            "target_object": f.target_object,
                            "transformation": f.transformation,
                            "default_value": f.default_value,
                        }
                        for f in m.field_mappings
                    ],
                }
                for m in self.object_mappings.values()
            ],
            "source_schemas": self.source_schemas,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> SchemaMap:
        """Create schema map from dictionary."""
        schema_map = cls()
        schema_map.source_schemas = data.get("source_schemas", {})

        for mapping_data in data.get("object_mappings", []):
            field_mappings = [
                FieldMapping(
                    source_field=f.get("source_field", ""),
                    target_property=f.get("target_property", ""),
                    target_object=f.get("target_object", ""),
                    transformation=f.get("transformation"),
                    default_value=f.get("default_value"),
                )
                for f in mapping_data.get("field_mappings", [])
            ]

            obj_mapping = ObjectMapping(
                source_type=mapping_data.get("source_type", ""),
                target_object=mapping_data.get("target_object", ""),
                field_mappings=field_mappings,
                filter_condition=mapping_data.get("filter_condition"),
            )
            schema_map.add_object_mapping(obj_mapping)

        return schema_map

    def save_to_file(self, filepath: str) -> None:
        """Save schema map to JSON file."""
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load_from_file(cls, filepath: str) -> SchemaMap:
        """Load schema map from JSON file."""
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)
