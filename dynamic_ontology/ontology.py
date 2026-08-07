"""Dynamic ontology system that can be modified at any time (US7962495)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
import json

from .core_types import (
    BaseType,
    ObjectInstance,
    ObjectPropertyMapping,
    ObjectType,
    ParserDefinition,
    ParserSubDefinition,
    ParserType,
    PropertyComponent,
    PropertyType,
    Validator,
    ValidatorType,
)


class DynamicOntology:
    """
    Dynamic ontology system that can be modified at any time.
    Implements the Ontology (106) from FIG. 1.

    Supports:
    - Object types with properties
    - Property types with components
    - Parser definitions for each property type
    - Validators for property types
    - Dynamic modification of all elements
    """

    def __init__(self) -> None:
        self.object_types: Dict[str, ObjectType] = {}
        self.property_types: Dict[str, PropertyType] = {}
        self.object_instances: Dict[str, ObjectInstance] = {}
        self.mappings: List[ObjectPropertyMapping] = []
        self._change_log: List[Dict[str, Any]] = []

    # ===== Object Type Management =====

    def create_object_type(
        self,
        name: str,
        display_name: str,
        uri: str,
        base_type: Optional[str] = None,
        icon: Optional[str] = None,
        description: Optional[str] = None,
        created_by: str = "system",
    ) -> ObjectType:
        """Create a new object type (step 202 from FIG. 2)."""
        if name in self.object_types:
            raise ValueError(f"Object type '{name}' already exists")

        obj_type = ObjectType(
            name=name,
            display_name=display_name,
            uri=uri,
            base_type=base_type,
            icon=icon,
            description=description,
            created_by=created_by,
        )
        self.object_types[name] = obj_type
        self._log_change("create_object_type", name, obj_type.to_dict())
        return obj_type

    def edit_object_type(self, name: str, **kwargs: Any) -> Optional[ObjectType]:
        """Edit an existing object type (step 204 from FIG. 2)."""
        if name not in self.object_types:
            return None

        obj_type = self.object_types[name]
        for key, value in kwargs.items():
            if hasattr(obj_type, key):
                setattr(obj_type, key, value)

        self._log_change("edit_object_type", name, obj_type.to_dict())
        return obj_type

    def delete_object_type(self, name: str) -> bool:
        """Delete an object type."""
        if name not in self.object_types:
            return False
        del self.object_types[name]
        self._log_change("delete_object_type", name, {})
        return True

    def get_object_type(self, name: str) -> Optional[ObjectType]:
        """Get an object type by name."""
        return self.object_types.get(name)

    def list_object_types(self) -> List[str]:
        """List all object type names."""
        return list(self.object_types.keys())

    def get_object_types_with_property(self, property_name: str) -> List[ObjectType]:
        """Get all object types that have a specific property."""
        return [
            obj_type
            for obj_type in self.object_types.values()
            if property_name in obj_type.property_types
        ]

    def add_property_to_object_type(self, object_type_name: str, property_type_name: str) -> bool:
        """Add a property type to an object type."""
        if object_type_name not in self.object_types:
            return False
        if property_type_name not in self.property_types:
            return False

        obj_type = self.object_types[object_type_name]
        if property_type_name not in obj_type.property_types:
            obj_type.property_types.append(property_type_name)
            self._log_change(
                "add_property_to_object",
                object_type_name,
                {"object_type": object_type_name, "property": property_type_name},
            )
        return True

    # ===== Property Type Management =====

    def create_property_type(
        self,
        name: str,
        display_name: str,
        base_type: BaseType,
        components: Optional[List[PropertyComponent]] = None,
        icon: Optional[str] = None,
        description: Optional[str] = None,
        display_formatter: Optional[str] = None,
        associated_words: Optional[List[str]] = None,
        created_by: str = "system",
    ) -> PropertyType:
        """Create a new property type (step 206 from FIG. 2)."""
        if name in self.property_types:
            raise ValueError(f"Property type '{name}' already exists")

        prop_type = PropertyType(
            name=name,
            display_name=display_name,
            base_type=base_type,
            components=components or [],
            icon=icon,
            description=description,
            display_formatter=display_formatter,
            associated_words=associated_words or [],
            created_by=created_by,
        )
        self.property_types[name] = prop_type
        self._log_change("create_property_type", name, prop_type.to_dict())
        return prop_type

    def edit_property_type(self, name: str, **kwargs: Any) -> Optional[PropertyType]:
        """Edit an existing property type (step 204 from FIG. 2)."""
        if name not in self.property_types:
            return None

        prop_type = self.property_types[name]
        for key, value in kwargs.items():
            if hasattr(prop_type, key):
                setattr(prop_type, key, value)

        self._log_change("edit_property_type", name, prop_type.to_dict())
        return prop_type

    def delete_property_type(self, name: str) -> bool:
        """Delete a property type."""
        if name not in self.property_types:
            return False
        for obj_type in self.object_types.values():
            if name in obj_type.property_types:
                obj_type.property_types.remove(name)
        del self.property_types[name]
        self._log_change("delete_property_type", name, {})
        return True

    def get_property_type(self, name: str) -> Optional[PropertyType]:
        """Get a property type by name."""
        return self.property_types.get(name)

    def list_property_types(self) -> List[str]:
        """List all property type names."""
        return list(self.property_types.keys())

    def add_component_to_property_type(
        self, property_type_name: str, component: PropertyComponent
    ) -> bool:
        """Add a component to a property type."""
        if property_type_name not in self.property_types:
            return False

        prop_type = self.property_types[property_type_name]
        prop_type.components.append(component)
        self._log_change("add_component", property_type_name, component.to_dict())
        return True

    def add_validator_to_property_type(
        self, property_type_name: str, validator: Validator
    ) -> bool:
        """Add a validator to a property type."""
        if property_type_name not in self.property_types:
            return False

        prop_type = self.property_types[property_type_name]
        prop_type.validators.append(validator)
        self._log_change("add_validator", property_type_name, validator.to_dict())
        return True

    # ===== Parser Definition Management =====

    def create_parser_definition(
        self,
        property_type_name: str,
        name: str,
        parser_type: ParserType,
        expression_pattern: str,
        sub_definitions: Optional[List[ParserSubDefinition]] = None,
        constraints: Optional[List[Validator]] = None,
        default_values: Optional[Dict[str, Any]] = None,
        priority: int = 0,
        created_by: str = "system",
    ) -> Optional[ParserDefinition]:
        """Create a parser definition for a property type (step 208 from FIG. 2)."""
        if property_type_name not in self.property_types:
            return None

        parser = ParserDefinition(
            name=name,
            parser_type=parser_type,
            expression_pattern=expression_pattern,
            property_type_name=property_type_name,
            sub_definitions=sub_definitions or [],
            constraints=constraints or [],
            default_values=default_values or {},
            created_by=created_by,
            priority=priority,
        )

        prop_type = self.property_types[property_type_name]
        prop_type.add_parser(parser)
        self._log_change("create_parser", property_type_name, parser.to_dict())
        return parser

    def edit_parser_definition(
        self, property_type_name: str, parser_name: str, **kwargs: Any
    ) -> Optional[ParserDefinition]:
        """Edit an existing parser definition (step 209 from FIG. 2)."""
        if property_type_name not in self.property_types:
            return None

        prop_type = self.property_types[property_type_name]
        for parser in prop_type.parser_definitions:
            if parser.name == parser_name:
                for key, value in kwargs.items():
                    if hasattr(parser, key):
                        setattr(parser, key, value)
                self._log_change("edit_parser", property_type_name, parser.to_dict())
                return parser
        return None

    def delete_parser_definition(self, property_type_name: str, parser_name: str) -> bool:
        """Delete a parser definition."""
        if property_type_name not in self.property_types:
            return False

        prop_type = self.property_types[property_type_name]
        for i, parser in enumerate(prop_type.parser_definitions):
            if parser.name == parser_name:
                del prop_type.parser_definitions[i]
                self._log_change(
                    "delete_parser", property_type_name, {"parser": parser_name}
                )
                return True
        return False

    def get_parser_definitions(self, property_type_name: str) -> List[ParserDefinition]:
        """Get all parser definitions for a property type."""
        prop_type = self.property_types.get(property_type_name)
        if prop_type:
            return prop_type.get_parsers_sorted()
        return []

    # ===== Object Instance Management =====

    def create_object_instance(
        self,
        object_type_name: str,
        properties: Optional[Dict[str, Any]] = None,
        created_by: str = "system",
    ) -> Optional[ObjectInstance]:
        """Create an instance of an object type."""
        if object_type_name not in self.object_types:
            return None

        obj = ObjectInstance(
            object_type=object_type_name,
            created_by=created_by,
            properties=properties or {},
        )
        self.object_instances[obj.id] = obj
        self._log_change("create_instance", obj.id, obj.to_dict())
        return obj

    def get_object_instance(self, obj_id: str) -> Optional[ObjectInstance]:
        """Get an object instance by ID."""
        return self.object_instances.get(obj_id)

    def get_object_instances_by_type(self, object_type_name: str) -> List[ObjectInstance]:
        """Get all object instances of a specific type."""
        return [
            obj
            for obj in self.object_instances.values()
            if obj.object_type == object_type_name
        ]

    def update_object_instance(
        self, obj_id: str, properties: Dict[str, Any]
    ) -> Optional[ObjectInstance]:
        """Update an object instance's properties."""
        obj = self.object_instances.get(obj_id)
        if not obj:
            return None
        obj.properties.update(properties)
        self._log_change("update_instance", obj_id, obj.to_dict())
        return obj

    # ===== Mapping Management =====

    def create_mapping(
        self,
        object_type: str,
        field_mappings: Dict[str, str],
        row_identifier: Optional[str] = None,
    ) -> ObjectPropertyMapping:
        """Create an object-property mapping."""
        mapping = ObjectPropertyMapping(
            object_type=object_type,
            field_mappings=field_mappings,
            row_identifier=row_identifier,
        )
        self.mappings.append(mapping)
        self._log_change("create_mapping", object_type, mapping.to_dict())
        return mapping

    def get_mappings_for_object_type(self, object_type: str) -> List[ObjectPropertyMapping]:
        """Get all mappings for an object type."""
        return [m for m in self.mappings if m.object_type == object_type]

    # ===== Data Transformation =====

    def parse_and_store_data(
        self, input_data: List[Dict[str, Any]], object_type_name: str
    ) -> List[ObjectInstance]:
        """
        Parse input data and store it in the ontology.
        Implements the process shown in FIG. 3.
        """
        results: List[ObjectInstance] = []

        obj_type = self.object_types.get(object_type_name)
        if not obj_type:
            return results

        mappings = self.get_mappings_for_object_type(object_type_name)
        if not mappings:
            default_mapping = ObjectPropertyMapping(
                object_type=object_type_name,
                field_mappings={},
            )
            if input_data:
                for key in input_data[0].keys():
                    if key in self.property_types:
                        default_mapping.field_mappings[key] = key
            mappings = [default_mapping]

        mapping = mappings[0]

        for row in input_data:
            obj = self.create_object_instance(object_type_name, created_by="parser")
            if not obj:
                continue

            for input_field, property_name in mapping.field_mappings.items():
                if input_field not in row:
                    continue

                raw_value = row[input_field]
                prop_type = self.property_types.get(property_name)
                if not prop_type:
                    obj.add_property(property_name, raw_value)
                    continue

                # Apply property-level validators on raw values for simple types
                if prop_type.base_type != BaseType.COMPOSITE:
                    valid, _msg = prop_type.validate_value(raw_value)
                    if not valid and prop_type.components and prop_type.components[0].default_value is not None:
                        obj.add_property(property_name, prop_type.components[0].default_value)
                        continue

                parsed_result = prop_type.parse_input(str(raw_value))

                if parsed_result is not None:
                    if prop_type.base_type == BaseType.COMPOSITE:
                        for comp_name, comp_value in parsed_result.items():
                            for component in prop_type.components:
                                if component.name == comp_name:
                                    if component.validator:
                                        valid, _msg = component.validator.validate(comp_value)
                                        if not valid:
                                            if component.default_value is not None:
                                                comp_value = component.default_value
                                            else:
                                                continue
                                    break
                            obj.add_property(f"{property_name}.{comp_name}", comp_value)
                    else:
                        first_value = (
                            next(iter(parsed_result.values())) if parsed_result else raw_value
                        )
                        obj.add_property(property_name, first_value)
                else:
                    if prop_type.components and prop_type.components[0].default_value is not None:
                        obj.add_property(property_name, prop_type.components[0].default_value)
                    else:
                        obj.add_property(property_name, raw_value)

            results.append(obj)

        return results

    # ===== Ontology Export/Import =====

    def to_dict(self) -> Dict[str, Any]:
        """Export the entire ontology to a dictionary."""
        return {
            "object_types": {name: obj.to_dict() for name, obj in self.object_types.items()},
            "property_types": {
                name: prop.to_dict() for name, prop in self.property_types.items()
            },
            "instances": {id_: obj.to_dict() for id_, obj in self.object_instances.items()},
            "mappings": [m.to_dict() for m in self.mappings],
            "change_log": self._change_log,
        }

    def to_json(self) -> str:
        """Export the ontology to JSON."""
        return json.dumps(self.to_dict(), indent=2, default=str)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> DynamicOntology:
        """Load an ontology from a dictionary."""
        ontology = cls()

        for name, prop_data in data.get("property_types", {}).items():
            components: List[PropertyComponent] = []
            for comp_data in prop_data.get("components", []):
                validator = None
                if comp_data.get("validator"):
                    validator = Validator(
                        validator_type=ValidatorType(comp_data["validator"]["validator_type"]),
                        value=comp_data["validator"]["value"],
                        error_message=comp_data["validator"].get("error_message"),
                    )
                components.append(
                    PropertyComponent(
                        name=comp_data["name"],
                        base_type=BaseType(comp_data["base_type"]),
                        description=comp_data.get("description"),
                        validator=validator,
                        default_value=comp_data.get("default_value"),
                        is_required=comp_data.get("is_required", False),
                    )
                )

            validators: List[Validator] = []
            for val_data in prop_data.get("validators", []):
                validators.append(
                    Validator(
                        validator_type=ValidatorType(val_data["validator_type"]),
                        value=val_data["value"],
                        error_message=val_data.get("error_message"),
                    )
                )

            parsers: List[ParserDefinition] = []
            for parser_data in prop_data.get("parser_definitions", []):
                sub_defs = [
                    ParserSubDefinition(
                        pattern=sub_data["pattern"],
                        property_component=sub_data["property_component"],
                        property_type_name=sub_data["property_type_name"],
                        default_value=sub_data.get("default_value"),
                        is_required=sub_data.get("is_required", False),
                    )
                    for sub_data in parser_data.get("sub_definitions", [])
                ]
                parsers.append(
                    ParserDefinition(
                        name=parser_data["name"],
                        parser_type=ParserType(parser_data["parser_type"]),
                        expression_pattern=parser_data["expression_pattern"],
                        property_type_name=parser_data["property_type_name"],
                        sub_definitions=sub_defs,
                        priority=parser_data.get("priority", 0),
                        is_active=parser_data.get("is_active", True),
                    )
                )

            prop_type = PropertyType(
                name=prop_data["name"],
                display_name=prop_data["display_name"],
                base_type=BaseType(prop_data["base_type"]),
                components=components,
                validators=validators,
                icon=prop_data.get("icon"),
                description=prop_data.get("description"),
                display_formatter=prop_data.get("display_formatter"),
                associated_words=prop_data.get("associated_words", []),
            )
            prop_type.parser_definitions = parsers
            ontology.property_types[name] = prop_type

        for name, obj_data in data.get("object_types", {}).items():
            ontology.object_types[name] = ObjectType(
                name=obj_data["name"],
                display_name=obj_data["display_name"],
                uri=obj_data["uri"],
                base_type=obj_data.get("base_type"),
                icon=obj_data.get("icon"),
                description=obj_data.get("description"),
                property_types=obj_data.get("property_types", []),
            )

        for id_, inst_data in data.get("instances", {}).items():
            ontology.object_instances[id_] = ObjectInstance(
                id=inst_data["id"],
                object_type=inst_data["object_type"],
                properties=inst_data.get("properties", {}),
                created_by=inst_data.get("created_by", "system"),
            )

        for map_data in data.get("mappings", []):
            ontology.mappings.append(
                ObjectPropertyMapping(
                    object_type=map_data["object_type"],
                    field_mappings=map_data["field_mappings"],
                    row_identifier=map_data.get("row_identifier"),
                )
            )

        return ontology

    @classmethod
    def from_json(cls, json_str: str) -> DynamicOntology:
        """Load an ontology from a JSON string."""
        return cls.from_dict(json.loads(json_str))

    def _log_change(self, action: str, target: str, data: Dict[str, Any]) -> None:
        """Log a change to the ontology."""
        self._change_log.append(
            {
                "timestamp": datetime.now().isoformat(),
                "action": action,
                "target": target,
                "data": data,
            }
        )
