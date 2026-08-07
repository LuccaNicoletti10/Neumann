"""YAML ontology loader — only used by OntologyRegistry."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .exceptions import OntologyValidationError
from .models import (
    LinkTypeDefinition,
    ObjectTypeDefinition,
    ParserDefinition,
    PropertyComponentDefinition,
    PropertyTypeDefinition,
    ValidatorDefinition,
)
from .parsers.registry import ParserRegistry, get_default_parser_registry
from .validators.registry import ValidatorRegistry, get_default_validator_registry


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise OntologyValidationError([f"YAML root must be a mapping: {path}"])
    return data


def _parse_components(raw: list[dict[str, Any]] | None) -> tuple[PropertyComponentDefinition, ...]:
    if not raw:
        return ()
    components = []
    for i, item in enumerate(raw):
        components.append(
            PropertyComponentDefinition(
                name=item["name"],
                data_type=item.get("type", item.get("data_type", "string")),
                required=bool(item.get("required", False)),
                default=item.get("default"),
                position=int(item.get("position", i)),
            )
        )
    return tuple(components)


def _parse_parsers(
    property_type_id: str,
    raw: list[dict[str, Any]] | None,
) -> tuple[ParserDefinition, ...]:
    if not raw:
        return ()
    parsers = []
    for item in raw:
        parsers.append(
            ParserDefinition(
                id=item["id"],
                property_type_id=property_type_id,
                name=item.get("name", item["id"]),
                parser_type=item.get("type", item.get("parser_type", item.get("transform", "transform"))),
                priority=int(item.get("priority", 100)),
                matcher=item.get("matcher", {"type": "any_non_null"}),
                transform=item["transform"],
                args=item.get("args", {}),
                output_component=item.get("output_component"),
                continue_on_invalid=bool(item.get("continue_on_invalid", False)),
                active=bool(item.get("active", True)),
                version=int(item.get("version", 1)),
            )
        )
    return tuple(parsers)


def _parse_validators(
    property_type_id: str,
    raw: list[dict[str, Any]] | None,
) -> tuple[ValidatorDefinition, ...]:
    if not raw:
        return ()
    validators = []
    for i, item in enumerate(raw):
        validators.append(
            ValidatorDefinition(
                id=item.get("id", f"{property_type_id}.validator.{i}"),
                property_type_id=property_type_id,
                validator_type=item.get("type", item.get("validator_type")),
                args=item.get("args", {}),
                error_code=item.get("error_code", "VALIDATION_FAILED"),
                message=item.get("message", "Validation failed"),
                severity=item.get("severity", "error"),
                position=int(item.get("position", i)),
            )
        )
    return tuple(validators)


def parse_object_file(data: dict[str, Any]) -> tuple[ObjectTypeDefinition, list[PropertyTypeDefinition], list[LinkTypeDefinition]]:
    obj_raw = data["object"]
    object_id = obj_raw["id"]
    object_name = obj_raw["name"]

    properties: list[PropertyTypeDefinition] = []
    prop_names: list[str] = []
    for prop_raw in data.get("properties", []):
        prop_id = prop_raw["id"]
        prop_name = prop_raw["name"]
        prop_names.append(prop_name)
        properties.append(
            PropertyTypeDefinition(
                id=prop_id,
                object_type=object_id,
                name=prop_name,
                data_type=prop_raw.get("type", prop_raw.get("data_type", "string")),
                required=bool(prop_raw.get("required", False)),
                nullable=bool(prop_raw.get("nullable", not prop_raw.get("required", False))),
                cardinality=prop_raw.get("cardinality", "one"),
                default=prop_raw.get("default"),
                components=_parse_components(prop_raw.get("components")),
                parsers=_parse_parsers(prop_id, prop_raw.get("parsers")),
                validators=_parse_validators(prop_id, prop_raw.get("validators")),
                active=bool(prop_raw.get("active", True)),
                description=prop_raw.get("description"),
            )
        )

    links: list[LinkTypeDefinition] = []
    link_ids: list[str] = []
    for link_raw in data.get("links", []):
        link_id = link_raw["id"]
        link_ids.append(link_id)
        links.append(
            LinkTypeDefinition(
                id=link_id,
                name=link_raw.get("name", link_id),
                source_object_type=link_raw.get("source", object_id),
                target_object_type=link_raw["target"],
                cardinality=link_raw.get("cardinality", "many"),
                required=bool(link_raw.get("required", False)),
                active=bool(link_raw.get("active", True)),
                description=link_raw.get("description"),
            )
        )

    obj = ObjectTypeDefinition(
        id=object_id,
        name=object_name,
        display_name=obj_raw.get("display_name", object_name),
        key_property=obj_raw["key_property"],
        properties=tuple(prop_names),
        links=tuple(link_ids),
        description=obj_raw.get("description"),
        base_type=obj_raw.get("base_type"),
        active=bool(obj_raw.get("active", True)),
    )
    return obj, properties, links


class OntologyLoader:
    """Load ontology YAML files from a directory tree."""

    def __init__(
        self,
        parser_registry: ParserRegistry | None = None,
        validator_registry: ValidatorRegistry | None = None,
    ) -> None:
        self.parser_registry = parser_registry or get_default_parser_registry()
        self.validator_registry = validator_registry or get_default_validator_registry()

    def load_directory(self, directory: str | Path) -> dict[str, Any]:
        directory = Path(directory)
        objects: dict[str, ObjectTypeDefinition] = {}
        properties: dict[str, PropertyTypeDefinition] = {}
        links: dict[str, LinkTypeDefinition] = {}

        for path in sorted(directory.glob("*.yaml")):
            data = _load_yaml(path)
            obj, props, link_defs = parse_object_file(data)
            if obj.id in objects:
                raise OntologyValidationError([f"Duplicate object id: {obj.id}"])
            objects[obj.id] = obj
            for prop in props:
                if prop.id in properties:
                    raise OntologyValidationError([f"Duplicate property id: {prop.id}"])
                properties[prop.id] = prop
            for link in link_defs:
                if link.id in links:
                    raise OntologyValidationError([f"Duplicate link id: {link.id}"])
                links[link.id] = link

        errors = self.validate_graph(objects, properties, links)
        if errors:
            raise OntologyValidationError(errors)

        return {
            "objects": objects,
            "properties": properties,
            "links": links,
        }

    def validate_graph(
        self,
        objects: dict[str, ObjectTypeDefinition],
        properties: dict[str, PropertyTypeDefinition],
        links: dict[str, LinkTypeDefinition],
    ) -> list[str]:
        errors: list[str] = []

        # Unique object names
        names: dict[str, str] = {}
        for obj in objects.values():
            if obj.name in names:
                errors.append(f"Duplicate object name: {obj.name}")
            names[obj.name] = obj.id
            if obj.key_property not in obj.properties:
                errors.append(
                    f"Object {obj.id} key_property '{obj.key_property}' not in properties"
                )

        prop_by_owner_name: dict[tuple[str, str], str] = {}
        for prop in properties.values():
            if prop.object_type not in objects:
                errors.append(f"Property {prop.id} references missing object {prop.object_type}")
            key = (prop.object_type, prop.name)
            if key in prop_by_owner_name:
                errors.append(f"Duplicate property name on object: {key}")
            prop_by_owner_name[key] = prop.id

            for parser in prop.parsers:
                if not self.parser_registry.has(parser.transform):
                    errors.append(
                        f"Parser {parser.id} references unknown transform '{parser.transform}'"
                    )
            for validator in prop.validators:
                if not self.validator_registry.has(validator.validator_type):
                    errors.append(
                        f"Validator {validator.id} references unknown type '{validator.validator_type}'"
                    )

        for link in links.values():
            if link.source_object_type not in objects:
                errors.append(f"Link {link.id} source missing: {link.source_object_type}")
            if link.target_object_type not in objects:
                errors.append(f"Link {link.id} target missing: {link.target_object_type}")

        return errors

    def apply_overrides(
        self,
        graph: dict[str, Any],
        overrides_path: str | Path | None,
    ) -> dict[str, Any]:
        if not overrides_path:
            return graph
        path = Path(overrides_path)
        if not path.exists():
            return graph

        data = _load_yaml(path)
        objects = dict(graph["objects"])
        properties = dict(graph["properties"])
        links = dict(graph["links"])

        for prop_raw in data.get("add_properties", []):
            obj_id = prop_raw["object_type"]
            prop_id = prop_raw["id"]
            prop = PropertyTypeDefinition(
                id=prop_id,
                object_type=obj_id,
                name=prop_raw["name"],
                data_type=prop_raw.get("type", "string"),
                required=bool(prop_raw.get("required", False)),
                nullable=bool(prop_raw.get("nullable", True)),
                cardinality=prop_raw.get("cardinality", "one"),
                default=prop_raw.get("default"),
                components=_parse_components(prop_raw.get("components")),
                parsers=_parse_parsers(prop_id, prop_raw.get("parsers")),
                validators=_parse_validators(prop_id, prop_raw.get("validators")),
                active=bool(prop_raw.get("active", True)),
                description=prop_raw.get("description"),
            )
            properties[prop_id] = prop
            obj = objects[obj_id]
            objects[obj_id] = ObjectTypeDefinition(
                id=obj.id,
                name=obj.name,
                display_name=obj.display_name,
                key_property=obj.key_property,
                properties=tuple([*obj.properties, prop.name]),
                links=obj.links,
                description=obj.description,
                base_type=obj.base_type,
                active=obj.active,
            )

        errors = self.validate_graph(objects, properties, links)
        if errors:
            raise OntologyValidationError(errors)

        return {"objects": objects, "properties": properties, "links": links}
