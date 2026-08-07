"""ConfigLoader — carrega YAMLs de um cliente sem hardcode no core."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class ClientIdentity(BaseModel):
    id: str
    name: str
    timezone: str = "America/Sao_Paulo"
    currency: str = "BRL"


class SourceConfig(BaseModel):
    name: str
    type: str
    config: dict[str, Any] = Field(default_factory=dict)


class ClientConfig(BaseModel):
    client: ClientIdentity
    sources: list[SourceConfig] = Field(default_factory=list)
    mappings: dict[str, Any] = Field(default_factory=dict)
    rules: dict[str, Any] = Field(default_factory=dict)
    ontology_overrides: dict[str, Any] = Field(default_factory=dict)


class ConfigLoader:
    """Carrega e valida a configuração declarativa de um cliente."""

    def __init__(self, config_root: str | Path) -> None:
        self.config_root = Path(config_root)

    def load(self, client: str) -> ClientConfig:
        root = self.config_root / client
        if not root.exists():
            raise FileNotFoundError(f"Config do cliente não encontrada: {root}")

        client_yaml = _read_yaml(root / "client.yaml")
        sources_yaml = _read_yaml(root / "sources.yaml")
        overrides = _read_yaml(root / "ontology_overrides.yaml")

        mappings: dict[str, Any] = {}
        mappings_dir = root / "mappings"
        if mappings_dir.exists():
            for path in mappings_dir.glob("*.yaml"):
                mappings[path.stem] = _read_yaml(path)

        rules: dict[str, Any] = {}
        rules_dir = root / "rules"
        if rules_dir.exists():
            for path in rules_dir.glob("*.yaml"):
                rules[path.stem] = _read_yaml(path)

        identity = ClientIdentity(
            id=client_yaml.get("id", client),
            name=client_yaml.get("name", client),
            timezone=client_yaml.get("timezone", "America/Sao_Paulo"),
            currency=client_yaml.get("currency", "BRL"),
        )
        sources = [
            SourceConfig(**item) for item in sources_yaml.get("sources", [])
        ]
        return ClientConfig(
            client=identity,
            sources=sources,
            mappings=mappings,
            rules=rules,
            ontology_overrides=overrides,
        )


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
