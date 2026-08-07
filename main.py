#!/usr/bin/env python3
"""Entry point for the Neumann data integration tool."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from data_integration.ontology import Ontology
from data_integration.schema_map import SchemaMap
from data_integration.transformation_engine import (
    CSVDataSource,
    JSONDataSource,
    ProactiveDebugger,
    TransformationEngine,
    TransformationScript,
)
from data_integration.unstructured import UnstructuredExtractor, save_extraction


ROOT = Path(__file__).resolve().parent
DEFAULT_ONTOLOGY = ROOT / "config" / "ontology_config.json"
DEFAULT_SCHEMA = ROOT / "config" / "schema_map.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Neumann Data Integration Tool (US8930897)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("gui", help="Launch the graphical interface")

    transform = sub.add_parser("transform", help="Run a mapped transformation")
    transform.add_argument("--ontology", type=Path, default=DEFAULT_ONTOLOGY)
    transform.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    transform.add_argument("--source", type=Path, required=True)
    transform.add_argument(
        "--source-type",
        default="csv",
        choices=["csv", "json", "extracted", "mwo"],
        help="Source type key used by schema map",
    )
    transform.add_argument("--target", default=None, help="Optional target object type")
    transform.add_argument("--output", type=Path, default=None)
    transform.add_argument("--debug", action="store_true")

    ingest = sub.add_parser(
        "ingest",
        help="Ingest unstructured text → extract → ontology objects",
    )
    ingest.add_argument("--source", type=Path, required=True, help="Path to .txt notes")
    ingest.add_argument("--ontology", type=Path, default=DEFAULT_ONTOLOGY)
    ingest.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    ingest.add_argument(
        "--extracted-out",
        type=Path,
        default=ROOT / "data" / "extracted.json",
        help="Where to save intermediate structured extraction",
    )
    ingest.add_argument(
        "--output",
        type=Path,
        default=ROOT / "data" / "ontology_objects.json",
        help="Where to save final ontology objects",
    )

    validate = sub.add_parser("validate", help="Validate a transformation script")
    validate.add_argument("--ontology", type=Path, default=DEFAULT_ONTOLOGY)
    validate.add_argument("--script", type=Path, required=True)

    debug = sub.add_parser("debug", help="Proactively debug a script against a source")
    debug.add_argument("--ontology", type=Path, default=DEFAULT_ONTOLOGY)
    debug.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    debug.add_argument("--script", type=Path, required=True)
    debug.add_argument("--source", type=Path, required=True)
    debug.add_argument("--source-type", default="csv", choices=["csv", "json"])
    debug.add_argument("--max-rows", type=int, default=10)

    return parser


def load_source(path: Path, source_type: str):
    if source_type in {"json", "extracted"} or path.suffix.lower() == ".json":
        if source_type == "extracted":
            return JSONDataSource(str(path), key="records")
        return JSONDataSource(str(path))
    return CSVDataSource(str(path))


def cmd_gui() -> int:
    from data_integration.gui import main as gui_main

    gui_main()
    return 0


def cmd_transform(args: argparse.Namespace) -> int:
    ontology = Ontology.load_from_file(str(args.ontology))
    schema_map = (
        SchemaMap.load_from_file(str(args.schema))
        if args.schema.exists()
        else SchemaMap()
    )
    engine = TransformationEngine(ontology, schema_map)
    engine.set_debug_mode(args.debug)

    source = load_source(args.source, args.source_type)
    result = engine.transform_data_source(
        source, args.source_type, args.target
    )

    print(f"Success: {result.success}")
    print(f"Objects created: {result.objects_created}")
    if result.errors:
        print("Errors:")
        for error in result.errors:
            print(f"  - {error}")
    if result.warnings:
        print("Warnings:")
        for warning in result.warnings:
            print(f"  - {warning}")

    if args.output:
        args.output.write_text(
            json.dumps(engine.collection.to_dict(), indent=2),
            encoding="utf-8",
        )
        print(f"Wrote objects to {args.output}")

    return 0 if result.success else 1


def cmd_ingest(args: argparse.Namespace) -> int:
    """Unstructured text → extraction → ontology objects."""
    if not args.source.exists():
        print(f"Source not found: {args.source}")
        return 1

    print("=== 1) INPUT (texto não estruturado) ===")
    text = args.source.read_text(encoding="utf-8")
    print(text[:500] + ("..." if len(text) > 500 else ""))
    print()

    extractor = UnstructuredExtractor()
    extraction = extractor.extract_text(text)
    args.extracted_out.parent.mkdir(parents=True, exist_ok=True)
    save_extraction(extraction, str(args.extracted_out))

    print("=== 2) EXTRACTION (estruturado intermediário) ===")
    print(f"People: {len(extraction.people)}")
    print(f"Organizations: {len(extraction.organizations)}")
    print(f"PhoneCalls: {len(extraction.phone_calls)}")
    print(f"Saved: {args.extracted_out}")
    print()

    ontology = Ontology.load_from_file(str(args.ontology))
    schema_map = (
        SchemaMap.load_from_file(str(args.schema))
        if args.schema.exists()
        else SchemaMap()
    )
    engine = TransformationEngine(ontology, schema_map)
    source = JSONDataSource(str(args.extracted_out), key="records")
    result = engine.transform_data_source(source, "extracted")

    print("=== 3) OUTPUT (objetos da ontologia) ===")
    print(f"Success: {result.success}")
    print(f"Objects created: {result.objects_created}")
    if result.errors:
        print("Errors:")
        for error in result.errors[:10]:
            print(f"  - {error}")

    for obj_type in ("Person", "Organization", "PhoneCall"):
        objs = engine.collection.get_objects_by_type(obj_type)
        if not objs:
            continue
        print(f"\n[{obj_type}] x{len(objs)}")
        for obj in objs:
            props = {k: p.value for k, p in obj.properties.items()}
            print(f"  - {props}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(engine.collection.to_dict(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nSaved final objects: {args.output}")
    return 0 if result.success else 1


def cmd_validate(args: argparse.Namespace) -> int:
    ontology = Ontology.load_from_file(str(args.ontology))
    engine = TransformationEngine(ontology, SchemaMap())
    content = args.script.read_text(encoding="utf-8")
    script = TransformationScript(str(args.script), content)

    is_valid = engine.validate_script(script)
    results = engine.get_validation_results()

    print("Valid" if is_valid else "Invalid")
    for error in results["errors"]:
        print(f"ERROR: {error}")
    for warning in results["warnings"]:
        print(f"WARNING: {warning}")

    return 0 if is_valid else 1


def cmd_debug(args: argparse.Namespace) -> int:
    ontology = Ontology.load_from_file(str(args.ontology))
    schema_map = (
        SchemaMap.load_from_file(str(args.schema))
        if args.schema.exists()
        else SchemaMap()
    )
    engine = TransformationEngine(ontology, schema_map)
    engine.set_debug_mode(True)

    content = args.script.read_text(encoding="utf-8")
    script = TransformationScript(str(args.script), content)
    source = load_source(args.source, args.source_type)

    debugger = ProactiveDebugger(engine)
    result = debugger.debug_script(
        script,
        source,
        max_rows=args.max_rows,
        source_type=args.source_type,
    )

    print(f"Objects created: {result.objects_created}")
    print(f"Summary: {debugger.get_debug_summary()}")
    if result.errors:
        print("Errors:")
        for error in result.errors:
            print(f"  - {error}")

    return 0 if result.success else 1


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "gui":
        return cmd_gui()
    if args.command == "transform":
        return cmd_transform(args)
    if args.command == "ingest":
        return cmd_ingest(args)
    if args.command == "validate":
        return cmd_validate(args)
    if args.command == "debug":
        return cmd_debug(args)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
