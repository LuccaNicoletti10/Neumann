"""Core ontology system for objects, properties, and links."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Set
import json


class EntityType(Enum):
    OBJECT = "object"
    PROPERTY = "property"
    LINK = "link"


@dataclass
class OntologyParameter:
    """Represents a single ontology parameter."""

    entity_name: str
    entity_type: EntityType
    parent_object: Optional[str] = None
    property_type: Optional[str] = None
    is_required: bool = False
    data_type: Optional[str] = None


class Ontology:
    """Manages ontology definitions including objects, properties, and relationships."""

    def __init__(self) -> None:
        self.objects: Dict[str, Dict[str, Any]] = {}
        self.properties: Dict[str, Dict[str, Any]] = {}
        self.links: Dict[str, Dict[str, Any]] = {}
        self.parameters: List[OntologyParameter] = []
        self._object_properties: Dict[str, Set[str]] = {}
        self._object_links: Dict[str, Set[str]] = {}

    @staticmethod
    def _property_key(parent_object: str, name: str) -> str:
        return f"{parent_object}.{name}"

    def add_object(self, name: str, description: str = "") -> None:
        """Add an object type to the ontology."""
        if name not in self.objects:
            self.objects[name] = {
                "name": name,
                "description": description,
            }
            self._object_properties[name] = set()
            self._object_links[name] = set()
            self.parameters.append(OntologyParameter(name, EntityType.OBJECT))

    def add_property(
        self,
        name: str,
        parent_object: str,
        data_type: str = "string",
        required: bool = False,
    ) -> None:
        """Add a property to an object type."""
        if parent_object not in self.objects:
            raise ValueError(f"Parent object '{parent_object}' not found in ontology")

        key = self._property_key(parent_object, name)
        self.properties[key] = {
            "name": name,
            "parent_object": parent_object,
            "data_type": data_type,
            "required": required,
        }
        self._object_properties[parent_object].add(name)
        self.parameters.append(
            OntologyParameter(
                name,
                EntityType.PROPERTY,
                parent_object,
                data_type,
                required,
                data_type,
            )
        )

    def add_link(
        self,
        name: str,
        from_object: str,
        to_object: str,
        relationship_type: str = "association",
    ) -> None:
        """Add a relationship/link between object types."""
        if from_object not in self.objects:
            raise ValueError(f"Source object '{from_object}' not found in ontology")
        if to_object not in self.objects:
            raise ValueError(f"Target object '{to_object}' not found in ontology")

        link_key = f"{from_object}_{to_object}_{name}"
        self.links[link_key] = {
            "name": name,
            "from_object": from_object,
            "to_object": to_object,
            "relationship_type": relationship_type,
        }
        self._object_links[from_object].add(link_key)
        self.parameters.append(
            OntologyParameter(
                link_key,
                EntityType.LINK,
                f"{from_object}->{to_object}",
            )
        )

    def get_object_properties(self, object_name: str) -> Set[str]:
        """Get all properties for an object."""
        return self._object_properties.get(object_name, set())

    def get_object_links(self, object_name: str) -> Set[str]:
        """Get all links for an object."""
        return self._object_links.get(object_name, set())

    def get_property_info(self, object_name: str, property_name: str) -> Dict[str, Any]:
        """Get property metadata for an object property."""
        return self.properties.get(self._property_key(object_name, property_name), {})

    def is_valid_object(self, name: str) -> bool:
        """Check if an object exists in the ontology."""
        return name in self.objects

    def is_valid_property(self, object_name: str, property_name: str) -> bool:
        """Check if a property is valid for an object."""
        return property_name in self._object_properties.get(object_name, set())

    def is_valid_link(self, from_object: str, to_object: str, link_name: str) -> bool:
        """Check if a link is valid between objects."""
        link_key = f"{from_object}_{to_object}_{link_name}"
        return link_key in self.links

    def validate_entity(
        self,
        entity_type: str,
        entity_name: str,
        parent_object: Optional[str] = None,
    ) -> bool:
        """Validate an entity against the ontology."""
        if entity_type == "object":
            return self.is_valid_object(entity_name)
        if entity_type == "property":
            if parent_object is None:
                return False
            return self.is_valid_property(parent_object, entity_name)
        if entity_type == "link":
            if parent_object is None:
                return False
            parts = parent_object.split("->")
            if len(parts) != 2:
                return False
            return self.is_valid_link(parts[0], parts[1], entity_name)
        return False

    def to_dict(self) -> Dict[str, Any]:
        """Convert ontology to dictionary for serialization."""
        return {
            "objects": {
                name: {
                    "name": data["name"],
                    "description": data.get("description", ""),
                }
                for name, data in self.objects.items()
            },
            "properties": self.properties,
            "links": self.links,
            "parameters": [
                {
                    "entity_name": p.entity_name,
                    "entity_type": p.entity_type.value,
                    "parent_object": p.parent_object,
                    "property_type": p.property_type,
                    "is_required": p.is_required,
                    "data_type": p.data_type,
                }
                for p in self.parameters
            ],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Ontology:
        """Create ontology from dictionary."""
        ontology = cls()

        for obj_name, obj_data in data.get("objects", {}).items():
            if isinstance(obj_data, dict):
                ontology.add_object(obj_name, obj_data.get("description", ""))
            else:
                ontology.add_object(obj_name)

        for _prop_key, prop_data in data.get("properties", {}).items():
            ontology.add_property(
                prop_data.get("name", _prop_key.split(".")[-1]),
                prop_data.get("parent_object", ""),
                prop_data.get("data_type", "string"),
                prop_data.get("required", False),
            )

        for _link_key, link_data in data.get("links", {}).items():
            ontology.add_link(
                link_data.get("name", _link_key),
                link_data.get("from_object", ""),
                link_data.get("to_object", ""),
                link_data.get("relationship_type", "association"),
            )

        return ontology

    def save_to_file(self, filepath: str) -> None:
        """Save ontology to JSON file."""
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load_from_file(cls, filepath: str) -> Ontology:
        """Load ontology from JSON file."""
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)
