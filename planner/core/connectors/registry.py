"""Registro de conectores por nome."""

from __future__ import annotations

from .base import Connector


class ConnectorRegistry:
    """Mantém conectores concretos registrados por nome."""

    def __init__(self) -> None:
        self._connectors: dict[str, Connector] = {}

    def register(self, connector: Connector) -> None:
        if not getattr(connector, "name", None):
            raise ValueError("Conector precisa de atributo name")
        self._connectors[connector.name] = connector

    def get(self, name: str) -> Connector:
        try:
            return self._connectors[name]
        except KeyError as exc:
            raise KeyError(f"Conector não registrado: {name}") from exc

    def list_names(self) -> list[str]:
        return sorted(self._connectors)


_DEFAULT = ConnectorRegistry()


def get_connector_registry() -> ConnectorRegistry:
    return _DEFAULT
