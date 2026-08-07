#!/usr/bin/env python3
"""Entry point for the Dynamic Ontology System (US7962495)."""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Neumann Dynamic Ontology (US7962495)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("gui", help="Launch Dynamic Ontology GUI")
    sub.add_parser("demo", help="Run headless parse/validate demo")

    export_p = sub.add_parser("export", help="Export sample ontology JSON")
    export_p.add_argument("-o", "--output", default="data/dynamic_ontology.json")

    parse_p = sub.add_parser("parse", help="Parse a CSV/JSON file into object instances")
    parse_p.add_argument("path", help="Input CSV or JSON file")
    parse_p.add_argument(
        "--object-type", default="Person", help="Target object type name"
    )

    args = parser.parse_args(argv)

    if args.command == "gui":
        from dynamic_ontology.app import main as app_main

        app_main()
        return 0

    if args.command == "demo":
        from dynamic_ontology.cli import run_demo

        return run_demo()

    if args.command == "export":
        from dynamic_ontology.cli import export_sample

        return export_sample(args.output)

    if args.command == "parse":
        from dynamic_ontology.cli import parse_file

        return parse_file(args.path, args.object_type)

    return 1


if __name__ == "__main__":
    sys.exit(main())
