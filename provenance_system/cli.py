#!/usr/bin/env python3
"""Command-line interface for the data provenance system."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional

from .build_service import BuildService
from .data_lake import DataLake
from .provenance import ProvenanceResolver
from .transaction_service import TransactionService


class ProvenanceCLI:
    """Command-line interface for provenance operations."""

    def __init__(self) -> None:
        self.data_lake = DataLake()
        self.tx_service = TransactionService(self.data_lake)
        self.build_service = BuildService(self.data_lake, self.tx_service)
        self.provenance_resolver = ProvenanceResolver(
            self.data_lake, self.build_service
        )

    def create_base_dataset(
        self,
        name: str,
        data: dict,
        description: Optional[str] = None,
    ) -> Optional[str]:
        tx_id, success = self.tx_service.start_transaction(name, "cli")
        if not success:
            return None
        self.tx_service.write_data(tx_id, data)
        return self.tx_service.commit_transaction(tx_id)

    def register_program(
        self,
        name: str,
        code: str,
        inputs: list,
        outputs: list,
    ) -> str:
        return self.build_service.register_derivation_program(
            name, code, inputs, outputs
        )

    def define_derived(self, dataset: str, program: str) -> bool:
        return self.build_service.define_derived_dataset(dataset, program)

    def build(self, dataset: str, force: bool = False) -> Optional[str]:
        return self.build_service.build_dataset(dataset, force)

    def build_all(self) -> dict:
        return self.build_service.build_all()

    def show_provenance(
        self,
        dataset: str,
        version: Optional[str] = None,
    ) -> Optional[dict]:
        if version:
            graph = self.provenance_resolver.get_full_provenance(dataset, version)
        else:
            graph = self.provenance_resolver.get_full_provenance_for_latest(dataset)
        return graph.to_dict() if graph else None

    def mark_invalid(
        self,
        dataset: str,
        version: str,
        reason: str = "Validation failed",
    ) -> None:
        self.provenance_resolver.mark_invalid(dataset, version, reason)

    def list_datasets(self) -> list:
        return self.data_lake.list_datasets()

    def list_versions(self, dataset: str) -> list:
        return [
            {
                "version_id": v.version_id,
                "created_at": v.created_at.isoformat(),
                "created_by": v.created_by,
                "size_bytes": v.size_bytes,
                "description": v.description,
            }
            for v in self.data_lake.get_all_versions(dataset)
        ]

    def load_demo(self) -> None:
        """Create the sample A/B/C/D/E → Final provenance graph."""
        for name, data in {
            "A": {"records": [{"id": 1, "name": "Alice"}], "source": "internal"},
            "B": {"records": [{"id": 10, "category": "X"}], "source": "external"},
            "C": {"records": [{"id": 20, "type": "alpha"}], "source": "third_party"},
            "D": {"records": [{"id": 30, "region": "north"}], "source": "sales_db"},
            "E": {"records": [{"id": 40, "product": "widget"}], "source": "catalog"},
        }.items():
            self.create_base_dataset(name, data)

        code = "def transform(input_data):\n    return {'combined': list(input_data.keys())}\n"
        self.register_program("P1", code, ["B", "C"], ["BC_Combined"])
        self.register_program("P2", code, ["D", "E"], ["DE_Combined"])
        self.register_program(
            "P3", code, ["BC_Combined", "DE_Combined"], ["Final"]
        )
        self.define_derived("BC_Combined", "P1")
        self.define_derived("DE_Combined", "P2")
        self.define_derived("Final", "P3")
        self.build_all()


def print_provenance_graph(graph_dict: dict) -> None:
    print("=" * 70)
    print("PROVENANCE GRAPH")
    print(
        f"Selected: {graph_dict['selected_dataset']} "
        f"(version {graph_dict['selected_version']})"
    )
    print("=" * 70)
    print()
    print("COMPOUND NODES (Datasets):")
    for name, node in graph_dict["nodes"].items():
        marker = " [TARGET]" if name == graph_dict["selected_dataset"] else ""
        print(f"  Dataset: {name}{marker}")
        for v_id, v_info in node["versions"].items():
            invalid = " [INV]" if v_id in node.get("invalid_versions", []) else ""
            pot_invalid = (
                " [P-INV]"
                if v_id in node.get("potentially_invalid_versions", [])
                else ""
            )
            desc = f" - {v_info.get('description', '')}" if v_info.get("description") else ""
            print(f"    ├─ {v_id}{invalid}{pot_invalid}{desc}")
    print()
    print("EDGES:")
    for edge in graph_dict.get("edges", []):
        marker = (
            " [POTENTIALLY INVALID]" if edge.get("is_potentially_invalid") else ""
        )
        arrow = "=!=>" if edge.get("is_potentially_invalid") else "===>"
        prog = (
            f" (via {edge.get('derivation_program', 'unknown')})"
            if edge.get("derivation_program")
            else ""
        )
        print(f"  {edge['from']} {arrow} {edge['to']}{marker}{prog}")
    print()
    stats = graph_dict.get("statistics", {})
    print("STATISTICS:")
    print(f"  Total Datasets: {stats.get('total_datasets', 0)}")
    print(f"  Total Versions: {stats.get('total_versions', 0)}")
    print(f"  Total Edges: {stats.get('total_edges', 0)}")
    print(f"  Invalid Versions: {stats.get('invalid_versions', 0)}")
    print("=" * 70)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Data Provenance System CLI")
    parser.add_argument(
        "command",
        choices=[
            "create",
            "register",
            "define",
            "build",
            "build-all",
            "provenance",
            "invalidate",
            "list",
            "versions",
            "demo",
        ],
        help="Command to execute",
    )
    parser.add_argument("--dataset", help="Dataset name")
    parser.add_argument("--version", help="Version ID")
    parser.add_argument("--program", help="Program name")
    parser.add_argument("--inputs", help="Comma-separated input datasets")
    parser.add_argument("--outputs", help="Comma-separated output datasets")
    parser.add_argument("--data", help="JSON data for creation")
    parser.add_argument("--reason", help="Reason for invalidation")
    parser.add_argument("--force", action="store_true", help="Force rebuild")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    cli = ProvenanceCLI()

    if args.command == "demo":
        cli.load_demo()
        graph = cli.show_provenance("Final")
        if graph:
            print_provenance_graph(graph)
        print("Datasets:", ", ".join(cli.list_datasets()))
        return 0

    if args.command == "create":
        if not args.dataset or not args.data:
            print("Error: --dataset and --data required")
            return 1
        version = cli.create_base_dataset(args.dataset, json.loads(args.data))
        print(f"Created dataset {args.dataset} version {version}")
        return 0

    if args.command == "register":
        if not args.program or not args.inputs or not args.outputs:
            print("Error: --program, --inputs, and --outputs required")
            return 1
        code = "def transform(inputs): return {'result': 'combined'}"
        version = cli.register_program(
            args.program,
            code,
            args.inputs.split(","),
            args.outputs.split(","),
        )
        print(f"Registered program {args.program} version {version}")
        return 0

    if args.command == "define":
        if not args.dataset or not args.program:
            print("Error: --dataset and --program required")
            return 1
        success = cli.define_derived(args.dataset, args.program)
        print(f"Defined {args.dataset} with program {args.program}: {success}")
        return 0

    if args.command == "build":
        if not args.dataset:
            print("Error: --dataset required")
            return 1
        version = cli.build(args.dataset, args.force)
        print(f"Built {args.dataset} version {version}")
        return 0

    if args.command == "build-all":
        for ds, ver in cli.build_all().items():
            print(f"  {ds}: {ver if ver else 'failed'}")
        return 0

    if args.command == "provenance":
        if not args.dataset:
            print("Error: --dataset required")
            return 1
        graph = cli.show_provenance(args.dataset, args.version)
        if graph:
            print_provenance_graph(graph)
            return 0
        print("No provenance found")
        return 1

    if args.command == "invalidate":
        if not args.dataset or not args.version:
            print("Error: --dataset and --version required")
            return 1
        cli.mark_invalid(
            args.dataset, args.version, args.reason or "Validation failed"
        )
        print(f"Marked {args.dataset}:{args.version} as invalid")
        return 0

    if args.command == "list":
        print("Datasets:")
        for ds in cli.list_datasets():
            print(f"  {ds}")
        return 0

    if args.command == "versions":
        if not args.dataset:
            print("Error: --dataset required")
            return 1
        print(f"Versions for {args.dataset}:")
        for v in cli.list_versions(args.dataset):
            print(
                f"  {v['version_id']} - {v['created_at']} - {v.get('description', '')}"
            )
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
