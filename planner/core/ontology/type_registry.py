"""Registry declarativo a partir de types.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .objects import OBJECT_TYPES


class TypeRegistry:
    """Carrega a definição canônica de tipos da ontologia."""

    def __init__(self, types_yaml: str | Path | None = None) -> None:
        path = Path(types_yaml) if types_yaml else Path(__file__).with_name("types.yaml")
        self.path = path
        self.definitions: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    def list_types(self) -> list[str]:
        return sorted(self.definitions)

    def get(self, type_name: str) -> dict[str, Any]:
        try:
            return self.definitions[type_name]
        except KeyError as exc:
            raise KeyError(f"Tipo de ontologia desconhecido: {type_name}") from exc

    def dataclass_for(self, type_name: str) -> type:
        try:
            return OBJECT_TYPES[type_name]
        except KeyError as exc:
            raise KeyError(f"Dataclass não implementada para: {type_name}") from exc

    def table_name(self, type_name: str) -> str:
        return type_name.lower()
