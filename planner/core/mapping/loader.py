"""Load client schema maps from YAML."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .models import FieldMapping, KeyMapping, SchemaMap


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_schema_map(path: str | Path, *, client: str) -> SchemaMap:
    path = Path(path)
    data = _load_yaml(path)
    target_object = data["target_object"]
    key = KeyMapping(
        source_field=data["key"]["source_field"],
        target_property=data["key"]["target_property"],
    )
    fields = tuple(
        FieldMapping(
            source_field=item["source"],
            target_property=item["target"],
            target_object=target_object,
            source_required=bool(item.get("required", False)),
            parser_override=item.get("parser_override"),
            source_type=item.get("source_type"),
        )
        for item in data.get("fields", [])
    )
    return SchemaMap(
        id=data.get("id", f"{client}.{path.stem}"),
        client=client,
        source=data.get("source", "csv_generic"),
        source_dataset=data.get("source_dataset", path.name),
        target_object=target_object,
        key=key,
        fields=fields,
        version=str(data.get("version", "1.0.0")),
        metadata=data.get("metadata", {}),
    )


def load_client_mappings(directory: str | Path, *, client: str) -> dict[str, SchemaMap]:
    directory = Path(directory)
    maps: dict[str, SchemaMap] = {}
    for path in sorted(directory.glob("*.yaml")):
        schema = load_schema_map(path, client=client)
        maps[path.stem] = schema
    return maps
