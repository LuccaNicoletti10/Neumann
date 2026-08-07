"""DSL builders for creating object models from data."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union

from .object_model import ObjectModel, ObjectModelCollection
from .ontology import Ontology


class DSLBuilder(ABC):
    """Abstract base class for DSL builders."""

    def __init__(self, ontology: Ontology, collection: ObjectModelCollection) -> None:
        self.ontology = ontology
        self.collection = collection
        self.validation_errors: List[str] = []
        self.validation_warnings: List[str] = []
        self.current_object: Optional[ObjectModel] = None

    @abstractmethod
    def build(self, data_item: Dict[str, Any]) -> Optional[ObjectModel]:
        """Build an object model from a data item."""

    def validate(self) -> bool:
        """Validate the builder configuration."""
        return len(self.validation_errors) == 0

    def get_validation_results(self) -> Dict[str, List[str]]:
        """Get validation results."""
        return {
            "errors": self.validation_errors,
            "warnings": self.validation_warnings,
        }


class GroovyStyleDSLBuilder(DSLBuilder):
    """Groovy-style DSL builder with shorthand notation and dynamic calls."""

    def __init__(self, ontology: Ontology, collection: ObjectModelCollection) -> None:
        super().__init__(ontology, collection)
        self._pending_object_type: Optional[str] = None
        self._pending_properties: Dict[str, Any] = {}
        self._pending_links: List[Dict[str, Any]] = []

    def __getattr__(self, name: str):
        """Handle undefined method calls for shorthand DSL notation."""

        def handler(**kwargs):
            return self._handle_dsl_method(name, kwargs)

        return handler

    def _handle_dsl_method(self, method_name: str, kwargs: Dict[str, Any]) -> Any:
        """Handle DSL method calls with validation against the ontology."""
        if self.ontology.is_valid_object(method_name):
            self._pending_object_type = method_name
            self._pending_properties.clear()
            self._pending_links.clear()

            for key, value in kwargs.items():
                if self.ontology.is_valid_property(method_name, key):
                    self._pending_properties[key] = value
                elif self._is_link_definition(key, value):
                    self._pending_links.append(
                        {
                            "link_type": key,
                            "target": value,
                        }
                    )
                else:
                    self.validation_errors.append(
                        f"Unknown property or link '{key}' for object type '{method_name}'"
                    )

            return self

        self.validation_errors.append(
            f"Unknown object type '{method_name}' - not defined in ontology"
        )
        return self

    def _is_link_definition(self, key: str, value: Any) -> bool:
        """Check if a key-value pair represents a link definition."""
        return isinstance(value, dict) and "to" in value and "type" in value

    def create(self, **kwargs) -> Optional[ObjectModel]:
        """Create the object using the current builder state."""
        if self._pending_object_type is None:
            self.validation_errors.append("No object type specified for creation")
            return None

        for prop_key, prop_info in self.ontology.properties.items():
            if (
                prop_info.get("required", False)
                and prop_info.get("parent_object") == self._pending_object_type
            ):
                prop_name = prop_info.get("name", prop_key)
                if prop_name not in self._pending_properties:
                    self.validation_errors.append(
                        f"Required property '{prop_name}' is missing for object type "
                        f"'{self._pending_object_type}'"
                    )
                    return None

        obj = ObjectModel(self._pending_object_type)

        for prop_name, prop_value in self._pending_properties.items():
            prop_info = self.ontology.get_property_info(
                self._pending_object_type, prop_name
            )
            data_type = prop_info.get("data_type", "string")
            obj.add_property(prop_name, prop_value, data_type)

        for link_def in self._pending_links:
            target_value = link_def.get("target")
            if isinstance(target_value, dict):
                target_ref = target_value.get("to")
                link_type = target_value.get("type", link_def.get("link_type", "link"))
            else:
                target_ref = target_value
                link_type = link_def.get("link_type", "link")

            target_objects = self.collection.find_objects("id", target_ref)
            if not target_objects:
                target_objects = self.collection.find_objects("name", target_ref)

            if target_objects:
                target = target_objects[0]
                if self.ontology.is_valid_link(
                    obj.object_type, target.object_type, link_type
                ):
                    obj.add_link(link_type, target)
                else:
                    self.validation_errors.append(
                        f"Invalid link '{link_type}' from '{obj.object_type}' "
                        f"to '{target.object_type}'"
                    )
            else:
                self.validation_errors.append(
                    f"Target object '{target_ref}' not found"
                )

        if self._validate_object(obj):
            self.collection.add_object(obj)
            self.current_object = obj
            return obj
        return None

    def _validate_object(self, obj: ObjectModel) -> bool:
        """Validate an object against the ontology."""
        valid = True

        for prop_name in obj.properties:
            if not self.ontology.is_valid_property(obj.object_type, prop_name):
                self.validation_errors.append(
                    f"Property '{prop_name}' is not valid for object type '{obj.object_type}'"
                )
                valid = False

        for link in obj.links:
            target = self.collection.get_object(link.to_object_id)
            if target:
                if not self.ontology.is_valid_link(
                    obj.object_type, target.object_type, link.link_type
                ):
                    self.validation_errors.append(
                        f"Link '{link.link_type}' is not valid between "
                        f"'{obj.object_type}' and '{target.object_type}'"
                    )
                    valid = False

        return valid

    def build(self, data_item: Dict[str, Any]) -> Optional[ObjectModel]:
        """Build an object from a data item using the DSL."""
        self._pending_object_type = None
        self._pending_properties.clear()
        self._pending_links.clear()
        self.validation_errors.clear()
        self.validation_warnings.clear()

        object_type = data_item.get("object_type") or data_item.get("type")
        if object_type and self.ontology.is_valid_object(object_type):
            self._pending_object_type = object_type

            for key, value in data_item.items():
                if key in {"type", "object_type", "_record_type"}:
                    # "type" may be the object discriminator; org_type carries Organization.type
                    continue
                prop_name = "type" if key == "org_type" else key
                if self.ontology.is_valid_property(object_type, prop_name):
                    self._pending_properties[prop_name] = value
                elif key == "links" and isinstance(value, list):
                    for link_def in value:
                        if isinstance(link_def, dict):
                            self._pending_links.append(link_def)
                else:
                    self.validation_warnings.append(
                        f"Ignoring unknown field '{key}' for object type '{object_type}'"
                    )

            return self.create()

        self.validation_errors.append(
            f"No valid object type found in data item: {data_item}"
        )
        return None

    def method_missing(self, name: str, *args, **kwargs):
        """Groovy-style method_missing for handling undefined methods."""
        if self.ontology.is_valid_object(name):
            self._pending_object_type = name
            return self

        if self._pending_object_type and self.ontology.is_valid_property(
            self._pending_object_type, name
        ):
            self._pending_properties[name] = args[0] if args else None
            return self

        self.validation_errors.append(f"Unknown method or property '{name}'")
        return self


class PythonStyleDSLBuilder(DSLBuilder):
    """Python-style DSL builder for creating object models."""

    def __init__(self, ontology: Ontology, collection: ObjectModelCollection) -> None:
        super().__init__(ontology, collection)
        self._current_object_data: Dict[str, Any] = {}

    def object(self, object_type: str, **kwargs) -> PythonStyleDSLBuilder:
        """Start building an object of the specified type."""
        if self.ontology.is_valid_object(object_type):
            self._current_object_data = {
                "type": object_type,
                "properties": {},
                "links": [],
            }

            for key, value in kwargs.items():
                if key == "type":
                    continue
                if self.ontology.is_valid_property(object_type, key):
                    self._current_object_data["properties"][key] = value
                else:
                    self.validation_errors.append(
                        f"Invalid property '{key}' for object type '{object_type}'"
                    )

            return self

        self.validation_errors.append(f"Unknown object type '{object_type}'")
        return self

    def property(self, name: str, value: Any) -> PythonStyleDSLBuilder:
        """Add a property to the current object."""
        if self._current_object_data:
            obj_type = self._current_object_data.get("type")
            if self.ontology.is_valid_property(obj_type, name):
                self._current_object_data["properties"][name] = value
            else:
                self.validation_errors.append(
                    f"Invalid property '{name}' for object type '{obj_type}'"
                )
        return self

    def link(
        self,
        link_type: str,
        to_object: Union[str, ObjectModel],
    ) -> PythonStyleDSLBuilder:
        """Add a link to the current object."""
        if not self._current_object_data:
            return self

        if isinstance(to_object, ObjectModel):
            target_id = to_object.id
        else:
            target_objects = self.collection.find_objects("name", to_object)
            if not target_objects:
                target_objects = self.collection.find_objects("id", to_object)
            if target_objects:
                target_id = target_objects[0].id
            else:
                self.validation_errors.append(f"Target object '{to_object}' not found")
                return self

        self._current_object_data["links"].append(
            {
                "type": link_type,
                "to": target_id,
            }
        )
        return self

    def build(self, data_item: Dict[str, Any]) -> Optional[ObjectModel]:
        """Build an object from a data item."""
        self.validation_errors.clear()
        self.validation_warnings.clear()

        if "type" not in data_item:
            self.validation_errors.append("Data item must have a 'type' field")
            return None

        obj_type = data_item["type"]
        props = {k: v for k, v in data_item.items() if k != "type"}
        return self.object(obj_type, **props)._build_current()

    def _build_current(self) -> Optional[ObjectModel]:
        """Build the current object."""
        if not self._current_object_data:
            self.validation_errors.append("No object data to build")
            return None

        obj_type = self._current_object_data.get("type")
        obj = ObjectModel(obj_type)

        for prop_name, prop_value in self._current_object_data.get(
            "properties", {}
        ).items():
            prop_info = self.ontology.get_property_info(obj_type, prop_name)
            obj.add_property(
                prop_name, prop_value, prop_info.get("data_type", "string")
            )

        for link_def in self._current_object_data.get("links", []):
            target = self.collection.get_object(link_def["to"])
            if target:
                if self.ontology.is_valid_link(
                    obj_type, target.object_type, link_def["type"]
                ):
                    obj.add_link(link_def["type"], target)
                else:
                    self.validation_errors.append(
                        f"Invalid link '{link_def['type']}' from '{obj_type}' "
                        f"to '{target.object_type}'"
                    )
            else:
                self.validation_errors.append(
                    f"Target object '{link_def['to']}' not found"
                )

        if self.validation_errors:
            return None

        self.collection.add_object(obj)
        self.current_object = obj
        return obj


class DSLBuilderFactory:
    """Factory for creating DSL builders."""

    @staticmethod
    def create_builder(
        style: str,
        ontology: Ontology,
        collection: ObjectModelCollection,
    ) -> DSLBuilder:
        """Create a DSL builder of the specified style."""
        if style == "groovy":
            return GroovyStyleDSLBuilder(ontology, collection)
        if style == "python":
            return PythonStyleDSLBuilder(ontology, collection)
        raise ValueError(f"Unknown builder style: {style}")
