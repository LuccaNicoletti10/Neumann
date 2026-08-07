"""Schema Map declarativo — mapeia colunas da fonte para a ontologia (Polars)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import polars as pl
import yaml

from .parsers import get_parser

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FieldMap:
    source: str
    target: str
    parser: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    required: bool = False


@dataclass(frozen=True)
class SchemaMapConfig:
    source: str
    source_dataset: str
    target_object: str
    key_source: str
    key_target: str
    fields: tuple[FieldMap, ...]
    defaults: dict[str, Any] = field(default_factory=dict)
    version: str = "1.0.0"


class SchemaMapLoader:
    """Carrega YAMLs de mappings de um diretório de cliente."""

    def load_directory(self, directory: str | Path) -> dict[str, SchemaMapConfig]:
        directory = Path(directory)
        result: dict[str, SchemaMapConfig] = {}
        for path in sorted(directory.glob("*.yaml")):
            result[path.stem] = self.load_file(path)
        return result

    def load_file(self, path: str | Path) -> SchemaMapConfig:
        path = Path(path)
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        key = data.get("key", {})
        # Compatível com formatos key.source / key.source_field
        key_source = key.get("source") or key.get("source_field")
        key_target = key.get("target") or key.get("target_property")

        fields: list[FieldMap] = []
        for item in data.get("fields", []):
            source = item.get("source") or item.get("source_field")
            target = item.get("target") or item.get("target_property")
            args = item.get("args", {})
            # Se args é o próprio mapping flat (ex: {KG: kg}), envelopa
            parser = item.get("parser")
            if parser == "map_values" and args and "mapping" not in args:
                args = {"mapping": args, "case_insensitive": True}
            fields.append(
                FieldMap(
                    source=source,
                    target=target,
                    parser=parser,
                    args=args,
                    required=bool(item.get("required", False)),
                )
            )

        return SchemaMapConfig(
            source=data.get("source", "csv_generic"),
            source_dataset=data.get("source_dataset", path.stem),
            target_object=data["target_object"],
            key_source=key_source,
            key_target=key_target,
            fields=tuple(fields),
            defaults=data.get("defaults", {}),
            version=str(data.get("version", "1.0.0")),
        )


def apply_schema_map(df: pl.DataFrame, mapping: SchemaMapConfig) -> pl.DataFrame:
    """
    Aplica o schema map sobre um DataFrame Polars.

    Se a coluna source não existir, registra WARNING e usa default se houver.
    """
    columns: dict[str, list[Any]] = {}
    n = df.height

    for field_map in mapping.fields:
        values: list[Any] = []
        if field_map.source not in df.columns:
            logger.warning(
                "Campo fonte ausente no DataFrame: %s → %s",
                field_map.source,
                field_map.target,
            )
            default = mapping.defaults.get(field_map.target)
            values = [default] * n
        else:
            series = df.get_column(field_map.source).to_list()
            parser_fn = get_parser(field_map.parser) if field_map.parser else None
            for raw in series:
                if parser_fn is None:
                    values.append(raw)
                else:
                    values.append(parser_fn(raw, field_map.args))
        columns[field_map.target] = values

    for key, default in mapping.defaults.items():
        if key not in columns:
            columns[key] = [default] * n

    if not columns:
        return pl.DataFrame()

    return pl.DataFrame(columns)
