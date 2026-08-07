"""Runtime object model for ontology instances."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Set
import uuid


@dataclass
class Property:
    """Represents a property of an object."""

    name: str
    value: Any
    data_type: str = "string"


@dataclass
class Link:
    """Represents a relationship between objects."""

    id: str
    link_type: str
    from_object_id: str
    to_object_id: str
    properties: Dict[str, Any] = field(default_factory=dict)


class ObjectModel:
    """Represents an object in the model."""

    def __init__(self, object_type: str, object_id: Optional[str] = None) -> None:
        self.object_type = object_type
        self.id = object_id or str(uuid.uuid4())
        self.properties: Dict[str, Property] = {}
        self.links: List[Link] = []
        self.created_at = datetime.now()
        self.updated_at = datetime.now()

    def add_property(self, name: str, value: Any, data_type: str = "string") -> None:
        """Add a property to this object."""
        self.properties[name] = Property(name, value, data_type)
        self.updated_at = datetime.now()

    def get_property(self, name: str) -> Optional[Any]:
        """Get a property value by name."""
        if name in self.properties:
            return self.properties[name].value
        return None

    def add_link(
        self,
        link_type: str,
        to_object: ObjectModel,
        properties: Optional[Dict[str, Any]] = None,
    ) -> Link:
        """Add a link to another object."""
        link = Link(
            id=str(uuid.uuid4()),
            link_type=link_type,
            from_object_id=self.id,
            to_object_id=to_object.id,
            properties=properties or {},
        )
        self.links.append(link)
        return link

    def to_dict(self) -> Dict[str, Any]:
        """Convert object to dictionary."""
        return {
            "id": self.id,
            "object_type": self.object_type,
            "properties": {
                name: {
                    "value": prop.value,
                    "data_type": prop.data_type,
                }
                for name, prop in self.properties.items()
            },
            "links": [
                {
                    "id": link.id,
                    "type": link.link_type,
                    "from": link.from_object_id,
                    "to": link.to_object_id,
                    "properties": link.properties,
                }
                for link in self.links
            ],
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ObjectModel:
        """Create object from dictionary."""
        obj = cls(data["object_type"], data["id"])

        for name, prop_data in data.get("properties", {}).items():
            obj.add_property(name, prop_data["value"], prop_data["data_type"])

        # Links are restored at collection level when all objects exist.
        return obj


class ObjectModelCollection:
    """Manages a collection of object models."""

    def __init__(self) -> None:
        self.objects: Dict[str, ObjectModel] = {}
        self.object_type_index: Dict[str, Set[str]] = {}

    def add_object(self, obj: ObjectModel) -> None:
        """Add an object to the collection."""
        self.objects[obj.id] = obj

        if obj.object_type not in self.object_type_index:
            self.object_type_index[obj.object_type] = set()
        self.object_type_index[obj.object_type].add(obj.id)

    def get_object(self, object_id: str) -> Optional[ObjectModel]:
        """Get an object by ID."""
        return self.objects.get(object_id)

    def get_objects_by_type(self, object_type: str) -> List[ObjectModel]:
        """Get all objects of a specific type."""
        obj_ids = self.object_type_index.get(object_type, set())
        return [self.objects[obj_id] for obj_id in obj_ids if obj_id in self.objects]

    def find_objects(self, property_name: str, property_value: Any) -> List[ObjectModel]:
        """Find objects by property value."""
        if property_name == "id":
            obj = self.objects.get(property_value)
            return [obj] if obj else []

        result = []
        for obj in self.objects.values():
            val = obj.get_property(property_name)
            if val == property_value:
                result.append(obj)
        return result

    def to_dict(self) -> Dict[str, Any]:
        """Convert collection to dictionary."""
        return {
            "objects": {
                obj_id: obj.to_dict() for obj_id, obj in self.objects.items()
            }
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ObjectModelCollection:
        """Create collection from dictionary."""
        collection = cls()
        for _obj_id, obj_data in data.get("objects", {}).items():
            obj = ObjectModel.from_dict(obj_data)
            collection.add_object(obj)

        # Restore links after all objects exist.
        for obj_id, obj_data in data.get("objects", {}).items():
            obj = collection.get_object(obj_id)
            if not obj:
                continue
            for link_data in obj_data.get("links", []):
                target = collection.get_object(link_data["to"])
                if target:
                    obj.add_link(
                        link_data["type"],
                        target,
                        link_data.get("properties", {}),
                    )
        return collection
