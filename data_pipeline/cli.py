#!/usr/bin/env python3
"""CLI for Universal Data Pipeline (US20170097950A1)."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional

from .pipeline import DataPipeline


class PipelineCLI:
    def __init__(self, with_demo: bool = False) -> None:
        self.pipeline = DataPipeline()
        self.pipeline.start()
        if with_demo:
            self.create_demo()

    def create_demo(self) -> None:
        print("=" * 60)
        print("CREATING DEMO DATASETS")
        print("=" * 60)

        self.pipeline.write_data(
            "Customers",
            {
                "records": [
                    {"id": 1, "name": "Alice", "city": "NYC", "tier": "gold"},
                    {"id": 2, "name": "Bob", "city": "LA", "tier": "silver"},
                    {"id": 3, "name": "Charlie", "city": "CHI", "tier": "gold"},
                    {"id": 4, "name": "Diana", "city": "NYC", "tier": "platinum"},
                ],
                "metadata": {"source": "CRM"},
            },
            description="Customer master data",
        )
        self.pipeline.write_data(
            "Orders",
            {
                "records": [
                    {"id": 101, "customer_id": 1, "amount": 250, "date": "2024-01-15"},
                    {"id": 102, "customer_id": 2, "amount": 500, "date": "2024-01-18"},
                    {"id": 103, "customer_id": 4, "amount": 1000, "date": "2024-01-25"},
                ],
                "metadata": {"source": "SalesDB"},
            },
            description="Order transaction data",
        )
        self.pipeline.write_data(
            "Products",
            {
                "records": [
                    {"id": 1, "name": "Widget", "price": 10.99},
                    {"id": 2, "name": "Gadget", "price": 24.99},
                ],
                "metadata": {"source": "Catalog"},
            },
            description="Product catalog",
        )

        self.pipeline.register_program(
            "CustomerOrders",
            """
def transform(inputs):
    customers = inputs['Customers']['records']
    orders = inputs['Orders']['records']
    result = []
    for order in orders:
        for customer in customers:
            if customer['id'] == order['customer_id']:
                result.append({
                    'customer_name': customer['name'],
                    'city': customer['city'],
                    'tier': customer['tier'],
                    'order_amount': order['amount'],
                    'order_date': order['date'],
                })
    return {'records': result}
""",
            ["Customers", "Orders"],
            ["CustomerOrdersSummary"],
            description="Joins Customers and Orders",
        )
        self.pipeline.register_program(
            "TierSummary",
            """
def transform(inputs):
    data = inputs['CustomerOrdersSummary']['output']['records']
    by_tier = {}
    for record in data:
        tier = record['tier']
        if tier not in by_tier:
            by_tier[tier] = {'count': 0, 'total': 0, 'customers': []}
        by_tier[tier]['count'] += 1
        by_tier[tier]['total'] += record['order_amount']
        if record['customer_name'] not in by_tier[tier]['customers']:
            by_tier[tier]['customers'].append(record['customer_name'])
    return {'by_tier': by_tier}
""",
            ["CustomerOrdersSummary"],
            ["CustomerTierSummary"],
            description="Summarizes by tier",
        )
        self.pipeline.register_program(
            "HighValue",
            """
def transform(inputs):
    data = inputs['CustomerOrdersSummary']['output']['records']
    return {'high_value_orders': [r for r in data if r['order_amount'] > 200]}
""",
            ["CustomerOrdersSummary"],
            ["HighValueOrders"],
            description="Filters orders > 200",
        )

        self.pipeline.define_derived_dataset("CustomerOrdersSummary", "CustomerOrders")
        self.pipeline.define_derived_dataset("CustomerTierSummary", "TierSummary")
        self.pipeline.define_derived_dataset("HighValueOrders", "HighValue")

        print("Building derived datasets...")
        for ds, ver in self.pipeline.build_all().items():
            print(f"  {ds}: {ver if ver else 'failed/up-to-date'}")

        self.pipeline.write_data(
            "Customers",
            {
                "records": [
                    {"id": 1, "name": "Alice", "city": "NYC", "tier": "platinum"},
                    {"id": 2, "name": "Bob", "city": "LA", "tier": "gold"},
                    {"id": 5, "name": "Eve", "city": "SF", "tier": "silver"},
                ],
                "metadata": {"source": "CRM", "updated": True},
            },
            description="Updated customers",
        )
        print("Rebuilding after Customers update...")
        self.pipeline.build_all()
        self._print_summary()

    def _print_summary(self) -> None:
        print("\n" + "=" * 60)
        print("PIPELINE SUMMARY")
        print("=" * 60)
        for ds in self.pipeline.list_datasets():
            info = self.pipeline.get_dataset_info(ds)
            latest = self.pipeline.get_latest_version(ds)
            print(
                f"  {ds}: type={info['dataset_type'] if info else '?'}, "
                f"versions={info['total_versions'] if info else 0}, latest={latest}"
            )
        for ds in self.pipeline.list_derived_datasets():
            deps = self.pipeline.get_build_dependencies(ds)
            print(f"  {ds} depends on: {', '.join(sorted(deps)) if deps else 'none'}")
        print(f"Total storage: {self.pipeline.get_total_storage_size()} bytes")
        print("=" * 60)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Universal Data Pipeline - US20170097950A1"
    )
    sub = parser.add_subparsers(dest="command")

    create = sub.add_parser("create")
    create.add_argument("--dataset", required=True)
    create.add_argument("--data")
    create.add_argument("--user", default="cli")
    create.add_argument("--description")

    read = sub.add_parser("read")
    read.add_argument("--dataset", required=True)
    read.add_argument("--version")

    sub.add_parser("list")

    hist = sub.add_parser("history")
    hist.add_argument("--dataset", required=True)

    reg = sub.add_parser("register")
    reg.add_argument("--name", required=True)
    reg.add_argument("--code")
    reg.add_argument("--code-file")
    reg.add_argument("--inputs")
    reg.add_argument("--outputs")
    reg.add_argument("--program-type", default="python")
    reg.add_argument("--description")

    build = sub.add_parser("build")
    build.add_argument("--dataset")
    build.add_argument("--all", action="store_true")
    build.add_argument("--force", action="store_true")

    deps = sub.add_parser("deps")
    deps.add_argument("--dataset", required=True)
    deps.add_argument("--recursive", action="store_true")

    rev = sub.add_parser("rev-deps")
    rev.add_argument("--dataset", required=True)

    prov = sub.add_parser("provenance")
    prov.add_argument("--dataset", required=True)
    prov.add_argument("--version")

    full = sub.add_parser("full-provenance")
    full.add_argument("--dataset", required=True)
    full.add_argument("--version")

    lineage = sub.add_parser("lineage")
    lineage.add_argument("--dataset", required=True)
    lineage.add_argument("--version")

    cmp = sub.add_parser("compare")
    cmp.add_argument("--dataset", required=True)
    cmp.add_argument("--version-a", required=True)
    cmp.add_argument("--version-b", required=True)

    sub.add_parser("info")
    exp = sub.add_parser("export")
    exp.add_argument("--output")
    sub.add_parser("graph")
    sub.add_parser("demo")

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 1

    cli = PipelineCLI(with_demo=False)

    if args.command == "demo":
        cli.create_demo()
        return 0

    if args.command == "create":
        data = json.loads(args.data) if args.data else {}
        ver = cli.pipeline.write_data(
            args.dataset, data, args.user, args.description
        )
        print(f"Created '{args.dataset}' version {ver}")
        return 0 if ver else 1

    if args.command == "read":
        data = cli.pipeline.read_data(args.dataset, args.version)
        print(json.dumps(data, indent=2, default=str) if data is not None else "Not found")
        return 0 if data is not None else 1

    if args.command == "list":
        print(f"{'Dataset':<24} {'Type':<10} {'Versions':<10} {'Latest'}")
        print("-" * 60)
        for ds in cli.pipeline.list_datasets():
            info = cli.pipeline.get_dataset_info(ds)
            print(
                f"{ds:<24} {info['dataset_type'] if info else '?':<10} "
                f"{info['total_versions'] if info else 0:<10} "
                f"{cli.pipeline.get_latest_version(ds)}"
            )
        return 0

    if args.command == "history":
        for v in cli.pipeline.get_version_history(args.dataset):
            print(
                f"  {v['version_id']}: {v['created_at']} by {v['created_by']} "
                f"size={v['size_bytes']} depth={v.get('lineage_depth', 0)}"
            )
        return 0

    if args.command == "register":
        if args.code_file:
            code = open(args.code_file, encoding="utf-8").read()
        else:
            code = args.code or "def transform(inputs): return inputs"
        ver = cli.pipeline.register_program(
            args.name,
            code,
            args.inputs.split(",") if args.inputs else [],
            args.outputs.split(",") if args.outputs else [],
            args.program_type,
            args.description,
        )
        print(f"Registered '{args.name}' version {ver}")
        return 0

    if args.command == "build":
        if args.all or not args.dataset:
            for ds, ver in cli.pipeline.build_all().items():
                print(f"  {ds}: {ver if ver else 'up-to-date/failed'}")
        else:
            print(cli.pipeline.build_dataset(args.dataset, args.force))
        return 0

    if args.command == "deps":
        print(sorted(cli.pipeline.get_build_dependencies(args.dataset)))
        if args.recursive:
            print("chain:", cli.pipeline.get_full_dependency_chain(args.dataset))
        return 0

    if args.command == "rev-deps":
        print(sorted(cli.pipeline.get_reverse_dependencies(args.dataset)))
        return 0

    if args.command == "provenance":
        version = args.version or cli.pipeline.get_latest_version(args.dataset)
        if not version:
            print("No version")
            return 1
        print(
            json.dumps(
                cli.pipeline.get_provenance_for_version(args.dataset, version),
                indent=2,
            )
        )
        return 0

    if args.command == "full-provenance":
        print(
            json.dumps(
                cli.pipeline.get_full_provenance(args.dataset, args.version),
                indent=2,
            )
        )
        return 0

    if args.command == "lineage":
        version = args.version or cli.pipeline.get_latest_version(args.dataset)
        if not version:
            print("No version")
            return 1
        lineage = cli.pipeline.get_version_lineage(args.dataset, version)
        print(" -> ".join(f"{x['dataset']}:{x['version']}" for x in lineage))
        return 0

    if args.command == "compare":
        print(
            json.dumps(
                cli.pipeline.compare_versions(
                    args.dataset, args.version_a, args.version_b
                ),
                indent=2,
            )
        )
        return 0

    if args.command == "info":
        print(json.dumps(cli.pipeline.get_status(), indent=2))
        print("graph:", cli.pipeline.get_build_dependency_graph())
        return 0

    if args.command == "export":
        path = args.output or "pipeline_state.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cli.pipeline.to_dict(), f, indent=2, default=str)
        print(f"Exported to {path}")
        return 0

    if args.command == "graph":
        for ds, deps in cli.pipeline.get_build_dependency_graph().items():
            print(f"{ds} -> {', '.join(deps) if deps else 'none'}")
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
