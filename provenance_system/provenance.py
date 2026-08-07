"""Provenance graph resolution and invalidity propagation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple
import json

from .build_service import BuildService
from .core_types import DatasetVersion
from .data_lake import DataLake


@dataclass
class ProvenanceNode:
    """Compound node representing a dataset and its versions."""

    dataset_name: str
    versions: Dict[str, DatasetVersion] = field(default_factory=dict)
    invalid_versions: Set[str] = field(default_factory=set)
    potentially_invalid_versions: Set[str] = field(default_factory=set)
    is_selected: bool = False

    def add_version(self, version: DatasetVersion) -> None:
        self.versions[version.version_id] = version

    def mark_invalid(self, version_id: str, reason: str = "Data validation failed") -> None:
        self.invalid_versions.add(version_id)

    def mark_potentially_invalid(self, version_id: str) -> None:
        self.potentially_invalid_versions.add(version_id)

    def is_version_invalid(self, version_id: str) -> bool:
        return version_id in self.invalid_versions

    def is_version_potentially_invalid(self, version_id: str) -> bool:
        return version_id in self.potentially_invalid_versions

    def get_version_metadata(self, version_id: str) -> Optional[Dict[str, Any]]:
        version = self.versions.get(version_id)
        if not version:
            return None
        return {
            "version_id": version.version_id,
            "created_at": version.created_at.isoformat(),
            "created_by": version.created_by,
            "parent_version_id": version.parent_version_id,
            "size_bytes": version.size_bytes,
            "description": version.description,
            "is_invalid": self.is_version_invalid(version_id),
            "is_potentially_invalid": self.is_version_potentially_invalid(version_id),
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "versions": {
                v_id: {
                    "version_id": v.version_id,
                    "created_at": v.created_at.isoformat(),
                    "created_by": v.created_by,
                    "parent_version_id": v.parent_version_id,
                    "size_bytes": v.size_bytes,
                    "description": v.description,
                }
                for v_id, v in self.versions.items()
            },
            "invalid_versions": list(self.invalid_versions),
            "potentially_invalid_versions": list(self.potentially_invalid_versions),
            "is_selected": self.is_selected,
        }


@dataclass
class ProvenanceEdge:
    """Edge representing a derivation dependency between versions."""

    from_dataset: str
    from_version: str
    to_dataset: str
    to_version: str
    derivation_program_name: Optional[str] = None
    derivation_program_version: Optional[str] = None
    is_potentially_invalid: bool = False
    invalid_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from": f"{self.from_dataset}:{self.from_version}",
            "to": f"{self.to_dataset}:{self.to_version}",
            "derivation_program": self.derivation_program_name,
            "derivation_program_version": self.derivation_program_version,
            "is_potentially_invalid": self.is_potentially_invalid,
            "invalid_reason": self.invalid_reason,
        }


@dataclass
class ProvenanceGraph:
    """Full provenance graph for a selected dataset version."""

    selected_dataset: str
    selected_version: str
    nodes: Dict[str, ProvenanceNode] = field(default_factory=dict)
    edges: List[ProvenanceEdge] = field(default_factory=list)
    total_datasets: int = 0
    total_versions: int = 0
    total_edges: int = 0
    invalid_versions_count: int = 0
    potentially_invalid_edges_count: int = 0
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def add_node(self, dataset_name: str) -> ProvenanceNode:
        if dataset_name not in self.nodes:
            self.nodes[dataset_name] = ProvenanceNode(dataset_name)
        return self.nodes[dataset_name]

    def add_version(self, dataset_name: str, version: DatasetVersion) -> None:
        node = self.add_node(dataset_name)
        if version.version_id not in node.versions:
            self.total_versions += 1
        node.add_version(version)

    def add_edge(
        self,
        from_dataset: str,
        from_version: str,
        to_dataset: str,
        to_version: str,
        prog_name: Optional[str] = None,
        prog_version: Optional[str] = None,
    ) -> None:
        self.edges.append(
            ProvenanceEdge(
                from_dataset=from_dataset,
                from_version=from_version,
                to_dataset=to_dataset,
                to_version=to_version,
                derivation_program_name=prog_name,
                derivation_program_version=prog_version,
            )
        )
        self.total_edges += 1

    def mark_version_invalid(
        self,
        dataset_name: str,
        version_id: str,
        reason: str = "",
    ) -> None:
        if dataset_name not in self.nodes:
            return
        if version_id not in self.nodes[dataset_name].invalid_versions:
            self.invalid_versions_count += 1
        self.nodes[dataset_name].mark_invalid(version_id, reason)
        self._propagate_invalidity(
            dataset_name, version_id, reason or "Dependency is invalid"
        )

    def _propagate_invalidity(
        self,
        dataset_name: str,
        version_id: str,
        reason: str,
    ) -> None:
        for edge in self.edges:
            if edge.to_dataset == dataset_name and edge.to_version == version_id:
                if not edge.is_potentially_invalid:
                    edge.is_potentially_invalid = True
                    edge.invalid_reason = reason
                    self.potentially_invalid_edges_count += 1
                self.nodes[edge.from_dataset].mark_potentially_invalid(edge.from_version)
                self._propagate_invalidity(
                    edge.from_dataset, edge.from_version, reason
                )

    def get_node(self, dataset_name: str) -> Optional[ProvenanceNode]:
        return self.nodes.get(dataset_name)

    def get_version_in_graph(
        self,
        dataset_name: str,
        version_id: str,
    ) -> Optional[DatasetVersion]:
        node = self.nodes.get(dataset_name)
        return node.versions.get(version_id) if node else None

    def get_edges_from(
        self,
        dataset_name: str,
        version_id: str,
    ) -> List[ProvenanceEdge]:
        return [
            e
            for e in self.edges
            if e.from_dataset == dataset_name and e.from_version == version_id
        ]

    def get_edges_to(
        self,
        dataset_name: str,
        version_id: str,
    ) -> List[ProvenanceEdge]:
        return [
            e
            for e in self.edges
            if e.to_dataset == dataset_name and e.to_version == version_id
        ]

    def get_invalid_versions(self) -> List[Tuple[str, str]]:
        result = []
        for ds, node in self.nodes.items():
            for v_id in node.invalid_versions:
                result.append((ds, v_id))
        return result

    def get_potentially_invalid_versions(self) -> List[Tuple[str, str]]:
        result = []
        for ds, node in self.nodes.items():
            for v_id in node.potentially_invalid_versions:
                if v_id not in node.invalid_versions:
                    result.append((ds, v_id))
        return result

    def get_statistics(self) -> Dict[str, Any]:
        return {
            "selected_dataset": self.selected_dataset,
            "selected_version": self.selected_version,
            "total_datasets": len(self.nodes),
            "total_versions": self.total_versions,
            "total_edges": self.total_edges,
            "invalid_versions": self.invalid_versions_count,
            "potentially_invalid_edges": self.potentially_invalid_edges_count,
            "valid_datasets": len(self.nodes) - self.invalid_versions_count,
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "selected_dataset": self.selected_dataset,
            "selected_version": self.selected_version,
            "nodes": {name: node.to_dict() for name, node in self.nodes.items()},
            "edges": [e.to_dict() for e in self.edges],
            "statistics": self.get_statistics(),
            "created_at": self.created_at,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, default=str)


class ProvenanceResolver:
    """Resolves recursive provenance for dataset versions."""

    def __init__(self, data_lake: DataLake, build_service: BuildService) -> None:
        self.data_lake = data_lake
        self.build_service = build_service
        self._invalid_flags: Dict[Tuple[str, str], str] = {}
        self._max_depth = 100

    def mark_invalid(
        self,
        dataset_name: str,
        version_id: str,
        reason: str = "Data validation failed",
    ) -> None:
        self._invalid_flags[(dataset_name, version_id)] = reason
        prov = self.data_lake.get_provenance(dataset_name, version_id)
        if prov:
            prov.is_flagged_invalid = True
            prov.flag_reason = reason
            prov.flagged_at = datetime.now()
            prov.flagged_by = "system"
            self.data_lake.set_provenance(dataset_name, version_id, prov)

    def is_invalid(self, dataset_name: str, version_id: str) -> bool:
        return (dataset_name, version_id) in self._invalid_flags

    def get_invalid_reason(
        self,
        dataset_name: str,
        version_id: str,
    ) -> Optional[str]:
        return self._invalid_flags.get((dataset_name, version_id))

    def clear_invalid_flag(self, dataset_name: str, version_id: str) -> None:
        self._invalid_flags.pop((dataset_name, version_id), None)
        prov = self.data_lake.get_provenance(dataset_name, version_id)
        if prov:
            prov.is_flagged_invalid = False
            prov.flag_reason = None
            prov.flagged_at = None
            prov.flagged_by = None
            self.data_lake.set_provenance(dataset_name, version_id, prov)

    def get_full_provenance(
        self,
        dataset_name: str,
        version_id: str,
        max_depth: int = 100,
    ) -> Optional[ProvenanceGraph]:
        if not self.data_lake.get_version(dataset_name, version_id):
            return None

        graph = ProvenanceGraph(dataset_name, version_id)
        visited: Set[Tuple[str, str]] = set()
        stack = [(dataset_name, version_id, 0)]

        while stack:
            current_ds, current_ver, depth = stack.pop()
            if (current_ds, current_ver) in visited or depth > max_depth:
                continue
            visited.add((current_ds, current_ver))

            version_obj = self.data_lake.get_version(current_ds, current_ver)
            if version_obj:
                graph.add_version(current_ds, version_obj)
                if self.is_invalid(current_ds, current_ver):
                    graph.mark_version_invalid(
                        current_ds,
                        current_ver,
                        self.get_invalid_reason(current_ds, current_ver) or "",
                    )

            entry = self.build_service.get_build_catalog_entry(current_ds, current_ver)
            if not entry:
                continue

            for dep in entry.input_dependencies:
                graph.add_edge(
                    current_ds,
                    current_ver,
                    dep.dataset_name,
                    dep.version_id,
                    entry.derivation_program_name,
                    entry.derivation_program_version,
                )
                dep_obj = self.data_lake.get_version(dep.dataset_name, dep.version_id)
                if dep_obj:
                    graph.add_version(dep.dataset_name, dep_obj)
                    if self.is_invalid(dep.dataset_name, dep.version_id):
                        graph.mark_version_invalid(
                            dep.dataset_name,
                            dep.version_id,
                            self.get_invalid_reason(dep.dataset_name, dep.version_id)
                            or "",
                        )
                stack.append((dep.dataset_name, dep.version_id, depth + 1))

        for ds, ver in list(self._invalid_flags):
            if ds in graph.nodes and ver in graph.nodes[ds].versions:
                graph.mark_version_invalid(
                    ds, ver, self.get_invalid_reason(ds, ver) or ""
                )

        return graph

    def get_full_provenance_for_latest(
        self,
        dataset_name: str,
    ) -> Optional[ProvenanceGraph]:
        latest = self.data_lake.get_latest_version(dataset_name)
        if not latest:
            return None
        return self.get_full_provenance(dataset_name, latest.version_id)

    def get_provenance_for_version_range(
        self,
        dataset_name: str,
        start_version: str,
        end_version: Optional[str] = None,
    ) -> Dict[str, ProvenanceGraph]:
        result: Dict[str, ProvenanceGraph] = {}
        found_start = False
        for v in self.data_lake.get_all_versions(dataset_name):
            if v.version_id == start_version:
                found_start = True
            if not found_start:
                continue
            graph = self.get_full_provenance(dataset_name, v.version_id)
            if graph:
                result[v.version_id] = graph
            if end_version and v.version_id == end_version:
                break
        return result

    def get_version_dependency_path(
        self,
        dataset_name: str,
        version_id: str,
    ) -> List[Dict[str, str]]:
        path: List[Dict[str, str]] = []
        current_ds = dataset_name
        current_ver = version_id

        while True:
            entry = self.build_service.get_build_catalog_entry(current_ds, current_ver)
            if not entry or not entry.input_dependencies:
                break
            path.append(
                {
                    "dataset": current_ds,
                    "version": current_ver,
                    "uses_program": entry.derivation_program_name,
                    "program_version": entry.derivation_program_version,
                }
            )
            dep = entry.input_dependencies[0]
            current_ds = dep.dataset_name
            current_ver = dep.version_id
        return path

    def compare_provenance(
        self,
        dataset_name: str,
        version_a: str,
        version_b: str,
    ) -> Dict[str, Any]:
        graph_a = self.get_full_provenance(dataset_name, version_a)
        graph_b = self.get_full_provenance(dataset_name, version_b)
        if not graph_a or not graph_b:
            return {"error": "One or both versions not found"}

        nodes_a = set(graph_a.nodes.keys())
        nodes_b = set(graph_b.nodes.keys())
        stats_a = graph_a.get_statistics()
        stats_b = graph_b.get_statistics()
        return {
            "version_a": version_a,
            "version_b": version_b,
            "stats_a": stats_a,
            "stats_b": stats_b,
            "datasets_a": list(nodes_a),
            "datasets_b": list(nodes_b),
            "datasets_only_a": list(nodes_a - nodes_b),
            "datasets_only_b": list(nodes_b - nodes_a),
            "datasets_common": list(nodes_a & nodes_b),
            "invalid_versions_a": graph_a.get_invalid_versions(),
            "invalid_versions_b": graph_b.get_invalid_versions(),
            "is_same_provenance": (
                nodes_a == nodes_b
                and stats_a["total_versions"] == stats_b["total_versions"]
            ),
        }
