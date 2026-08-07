"""Ontology registry — sole access point for ontology definitions."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .exceptions import DefinitionNotFoundError
from .loader import OntologyLoader
from .models import (
    LinkTypeDefinition,
    ObjectTypeDefinition,
    OntologySnapshot,
    PropertyTypeDefinition,
    json_safe,
)
from .parsers.registry import ParserRegistry, get_default_parser_registry
from .validators.registry import ValidatorRegistry, get_default_validator_registry


def compute_checksum(graph: dict[str, Any]) -> str:
    payload = {
        "objects": {
            k: {
                "id": v.id,
                "name": v.name,
                "key_property": v.key_property,
                "properties": list(v.properties),
                "links": list(v.links),
                "active": v.active,
            }
            for k, v in sorted(graph["objects"].items())
        },
        "properties": {
            k: {
                "id": v.id,
                "object_type": v.object_type,
                "name": v.name,
                "data_type": v.data_type,
                "required": v.required,
                "nullable": v.nullable,
                "default": json_safe(v.default),
                "parsers": [
                    {
                        "id": p.id,
                        "priority": p.priority,
                        "transform": p.transform,
                        "matcher": dict(p.matcher),
                        "args": dict(p.args),
                        "version": p.version,
                    }
                    for p in v.parsers
                ],
                "validators": [
                    {
                        "id": vd.id,
                        "type": vd.validator_type,
                        "args": dict(vd.args),
                    }
                    for vd in v.validators
                ],
            }
            for k, v in sorted(graph["properties"].items())
        },
        "links": {
            k: {
                "id": v.id,
                "source": v.source_object_type,
                "target": v.target_object_type,
            }
            for k, v in sorted(graph["links"].items())
        },
    }
    raw = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


class OntologyRegistry:
    """In-memory multi-version ontology registry."""

    def __init__(
        self,
        parser_registry: ParserRegistry | None = None,
        validator_registry: ValidatorRegistry | None = None,
    ) -> None:
        self.parser_registry = parser_registry or get_default_parser_registry()
        self.validator_registry = validator_registry or get_default_validator_registry()
        self._loader = OntologyLoader(self.parser_registry, self.validator_registry)
        self._snapshots: dict[str, OntologySnapshot] = {}
        self._published_by_client: dict[str, str] = {}

    def load_client(
        self,
        client: str,
        *,
        core_dir: str | Path,
        overrides_path: str | Path | None = None,
        version: str = "1.0.0",
        version_id: str | None = None,
        publish: bool = True,
    ) -> OntologySnapshot:
        graph = self._loader.load_directory(core_dir)
        graph = self._loader.apply_overrides(graph, overrides_path)
        checksum = compute_checksum(graph)
        vid = version_id or f"{client}:{version}:{checksum[:12]}"

        object_names = {obj.name: obj.id for obj in graph["objects"].values()}
        property_names = {
            (graph["objects"][prop.object_type].name, prop.name): prop.id
            for prop in graph["properties"].values()
            if prop.object_type in graph["objects"]
        }

        snapshot = OntologySnapshot(
            version_id=vid,
            client=client,
            semantic_version=version,
            checksum=checksum,
            objects=dict(graph["objects"]),
            properties=dict(graph["properties"]),
            links=dict(graph["links"]),
            object_names=object_names,
            property_names=property_names,
        )
        self._snapshots[vid] = snapshot
        if publish:
            self._published_by_client[client] = vid
        return snapshot

    def register_snapshot(self, snapshot: OntologySnapshot, *, publish: bool = False) -> None:
        self._snapshots[snapshot.version_id] = snapshot
        if publish:
            self._published_by_client[snapshot.client] = snapshot.version_id

    def get_snapshot(self, version_id: str) -> OntologySnapshot:
        try:
            return self._snapshots[version_id]
        except KeyError as exc:
            raise DefinitionNotFoundError("OntologyVersion", version_id) from exc

    def get_published(self, client: str) -> OntologySnapshot:
        vid = self._published_by_client.get(client)
        if not vid:
            raise DefinitionNotFoundError("PublishedOntology", client)
        return self.get_snapshot(vid)

    def get_object(self, object_type_id: str, version_id: str) -> ObjectTypeDefinition:
        snap = self.get_snapshot(version_id)
        # allow lookup by name or id
        oid = snap.object_names.get(object_type_id, object_type_id)
        try:
            return snap.objects[oid]
        except KeyError as exc:
            raise DefinitionNotFoundError("ObjectType", object_type_id) from exc

    def get_property(
        self,
        object_type: str,
        property_name: str,
        version_id: str,
    ) -> PropertyTypeDefinition:
        snap = self.get_snapshot(version_id)
        oid = snap.object_names.get(object_type, object_type)
        obj = snap.objects.get(oid)
        if not obj:
            raise DefinitionNotFoundError("ObjectType", object_type)
        key = (obj.name, property_name)
        prop_id = snap.property_names.get(key)
        if not prop_id:
            raise DefinitionNotFoundError("PropertyType", f"{object_type}.{property_name}")
        return snap.properties[prop_id]

    def get_property_by_id(
        self, property_type_id: str, version_id: str
    ) -> PropertyTypeDefinition:
        snap = self.get_snapshot(version_id)
        try:
            return snap.properties[property_type_id]
        except KeyError as exc:
            raise DefinitionNotFoundError("PropertyType", property_type_id) from exc

    def get_link(self, link_type_id: str, version_id: str) -> LinkTypeDefinition:
        snap = self.get_snapshot(version_id)
        try:
            return snap.links[link_type_id]
        except KeyError as exc:
            raise DefinitionNotFoundError("LinkType", link_type_id) from exc

    def list_versions(self, client: str | None = None) -> list[OntologySnapshot]:
        snaps = list(self._snapshots.values())
        if client:
            snaps = [s for s in snaps if s.client == client]
        return sorted(snaps, key=lambda s: s.semantic_version)
