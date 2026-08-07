"""CLI for ontology validate/publish/parse/ingest/quarantine."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def _paths(client: str) -> dict[str, Path]:
    return {
        "core": ROOT / "config" / "core" / "ontology",
        "overrides": ROOT / "config" / client / "ontology_overrides.yaml",
        "mappings": ROOT / "config" / client / "mappings",
        "fixtures": ROOT / "fixtures" / client,
    }


def _boot(client: str, version: str = "1.0.0"):
    from planner.core.ingestion.quarantine import QuarantineStore
    from planner.core.ingestion.service import IngestionService
    from planner.core.mapping.executor import MappingExecutor
    from planner.core.mapping.loader import load_client_mappings
    from planner.core.ontology.parsers.engine import ParserEngine
    from planner.core.ontology.registry import OntologyRegistry
    from planner.core.ontology.repository import OntologyRepository

    paths = _paths(client)
    registry = OntologyRegistry()
    snapshot = registry.load_client(
        client,
        core_dir=paths["core"],
        overrides_path=paths["overrides"] if paths["overrides"].exists() else None,
        version=version,
        publish=True,
    )
    parser_engine = ParserEngine(registry)
    repository = OntologyRepository()
    quarantine = QuarantineStore()
    ingestion = IngestionService(
        ontology_registry=registry,
        parser_engine=parser_engine,
        mapping_executor=MappingExecutor(registry),
        repository=repository,
        quarantine=quarantine,
    )
    mappings = (
        load_client_mappings(paths["mappings"], client=client)
        if paths["mappings"].exists()
        else {}
    )
    return {
        "registry": registry,
        "snapshot": snapshot,
        "parser_engine": parser_engine,
        "ingestion": ingestion,
        "quarantine": quarantine,
        "mappings": mappings,
        "paths": paths,
    }


def cmd_ontology_validate(args: argparse.Namespace) -> int:
    ctx = _boot(args.client)
    snap = ctx["snapshot"]
    print(f"Client: {args.client}")
    print(f"Version: {snap.semantic_version}")
    print(f"Checksum: {snap.checksum}")
    print(f"Objects: {len(snap.objects)}")
    print(f"Properties: {len(snap.properties)}")
    print("Validation: OK")
    return 0


def cmd_ontology_diff(args: argparse.Namespace) -> int:
    from planner.core.ontology.compatibility import analyze_compatibility
    from planner.core.ontology.registry import OntologyRegistry

    paths = _paths(args.client)
    registry = OntologyRegistry()
    # Load twice with different version labels — same files unless overrides differ
    left = registry.load_client(
        args.client,
        core_dir=paths["core"],
        overrides_path=paths["overrides"] if paths["overrides"].exists() else None,
        version=args.from_version,
        version_id=f"{args.client}:{args.from_version}",
        publish=False,
    )
    right = registry.load_client(
        args.client,
        core_dir=paths["core"],
        overrides_path=paths["overrides"] if paths["overrides"].exists() else None,
        version=args.to_version,
        version_id=f"{args.client}:{args.to_version}",
        publish=False,
    )
    report = analyze_compatibility(left, right)
    print(f"Diff {args.from_version} → {args.to_version}")
    print(f"Breaking: {report.breaking}")
    for msg in report.messages:
        print(f"  - {msg}")
    if not report.messages:
        print("  (no differences in loaded definitions)")
    return 0


def cmd_ontology_publish(args: argparse.Namespace) -> int:
    from planner.core.ontology.repository import OntologyRepository
    from planner.core.ontology.versioning import OntologyVersionService

    ctx = _boot(args.client, version=args.version)
    repo = OntologyRepository()
    service = OntologyVersionService(ctx["registry"], repo)
    draft = service.create_draft(
        args.client,
        args.version,
        {
            "snapshot_version_id": ctx["snapshot"].version_id,
            "checksum": ctx["snapshot"].checksum,
        },
        created_by="cli",
    )
    published = service.publish(draft.id, ctx["snapshot"])
    print(f"Published {published.client}@{published.version}")
    print(f"Status: {published.status.value}")
    print(f"Checksum: {published.checksum}")
    return 0


def cmd_parse_property(args: argparse.Namespace) -> int:
    ctx = _boot(args.client)
    snap = ctx["snapshot"]
    prop = ctx["registry"].get_property(args.object, args.property, snap.version_id)
    result = ctx["parser_engine"].parse_property(
        prop.id, args.value, snap.version_id
    )
    print(f"Raw value: {args.value}")
    print(f"Property: {args.object}.{args.property}")
    print(f"Ontology: {snap.semantic_version}")
    print(f"Parser: {result.parser_id}")
    print(f"Canonical value: {result.canonical_value}")
    print(f"Status: {result.status.value}")
    print(f"Validation: {'passed' if result.ok else 'failed'}")
    if result.errors:
        print(f"Errors: {list(result.errors)}")
    return 0 if result.ok else 1


def cmd_ingest(args: argparse.Namespace) -> int:
    from planner.core.ingestion.result import IngestionContext

    ctx = _boot(args.client)
    dataset = args.dataset
    schema = ctx["mappings"].get(dataset)
    if not schema:
        # try products alias
        schema = ctx["mappings"].get(dataset.rstrip("s") + "s") if False else None
        schema = ctx["mappings"].get(dataset)
    if not schema:
        available = ", ".join(ctx["mappings"]) or "(none)"
        print(f"Unknown dataset '{dataset}'. Available: {available}", file=sys.stderr)
        return 1

    fixture = ctx["paths"]["fixtures"] / schema.source_dataset
    if args.file:
        fixture = Path(args.file)
    if not fixture.exists():
        print(f"Fixture not found: {fixture}", file=sys.stderr)
        return 1

    with fixture.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    context = IngestionContext(
        client=args.client,
        run_id=str(uuid4()),
        ontology_version_id=ctx["snapshot"].version_id,
        dataset=dataset,
        dry_run=args.dry_run,
        max_error_rate=args.max_error_rate,
    )
    report = ctx["ingestion"].ingest_rows(rows, schema, context)

    print(f"Dataset: {dataset}")
    print(f"Total: {report.total}")
    print(f"Accepted: {report.accepted}")
    print(f"Quarantined: {report.quarantined}")
    print(f"Error rate: {report.error_rate:.0%}")
    if report.aborted:
        print(f"Aborted: {report.abort_reason}")
    if args.dry_run:
        print("Mode: dry-run")

    for result in report.results:
        if result.success and result.object:
            props = {
                k.split(".")[-1]: v.value for k, v in result.object.properties.items()
            }
            print(f"  OK {result.object.key}: {props}")
        else:
            print(f"  FAIL {result.source_ref}: {result.errors}")

    return 0 if not report.aborted else 2


def cmd_quarantine_list(args: argparse.Namespace) -> int:
    # Quarantine is process-local unless we persist — for CLI demo, re-run ingest first
    # or load from a previous in-memory is empty. Provide guidance by running ingest silently.
    from planner.core.ingestion.result import IngestionContext

    ctx = _boot(args.client)
    dataset = args.dataset
    schema = ctx["mappings"].get(dataset)
    if not schema:
        print(f"Unknown dataset '{dataset}'", file=sys.stderr)
        return 1

    fixture = ctx["paths"]["fixtures"] / schema.source_dataset
    if fixture.exists():
        with fixture.open("r", encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        context = IngestionContext(
            client=args.client,
            run_id=str(uuid4()),
            ontology_version_id=ctx["snapshot"].version_id,
            dataset=dataset,
            dry_run=True,
        )
        ctx["ingestion"].ingest_rows(rows, schema, context)

    records = ctx["quarantine"].list(client=args.client, dataset=dataset)
    if not records:
        print("No quarantine records")
        return 0

    for rec in records:
        print(
            json.dumps(
                {
                    "id": str(rec.id),
                    "source_ref": rec.source_ref,
                    "error_code": rec.error_code,
                    "error_path": rec.error_path,
                    "error_message": rec.error_message,
                    "status": rec.status.value,
                },
                ensure_ascii=False,
            )
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="planner", description="Neumann Planner CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    ont = sub.add_parser("ontology", help="Ontology lifecycle")
    ont_sub = ont.add_subparsers(dest="ontology_command", required=True)

    v = ont_sub.add_parser("validate", help="Validate client ontology YAML")
    v.add_argument("--client", required=True)
    v.set_defaults(func=cmd_ontology_validate)

    d = ont_sub.add_parser("diff", help="Diff two ontology versions")
    d.add_argument("--client", required=True)
    d.add_argument("--from", dest="from_version", required=True)
    d.add_argument("--to", dest="to_version", required=True)
    d.set_defaults(func=cmd_ontology_diff)

    p = ont_sub.add_parser("publish", help="Publish ontology version")
    p.add_argument("--client", required=True)
    p.add_argument("--version", required=True)
    p.set_defaults(func=cmd_ontology_publish)

    pp = sub.add_parser("parse-property", help="Parse a single property value")
    pp.add_argument("--client", required=True)
    pp.add_argument("--object", required=True)
    pp.add_argument("--property", required=True)
    pp.add_argument("--value", required=True)
    pp.set_defaults(func=cmd_parse_property)

    ing = sub.add_parser("ingest", help="Ingest a mapped dataset")
    ing.add_argument("--client", required=True)
    ing.add_argument("--dataset", required=True)
    ing.add_argument("--file", help="Override fixture path")
    ing.add_argument("--dry-run", action="store_true")
    ing.add_argument("--max-error-rate", type=float, default=0.5)
    ing.set_defaults(func=cmd_ingest)

    q = sub.add_parser("quarantine", help="Quarantine tools")
    q_sub = q.add_subparsers(dest="quarantine_command", required=True)
    ql = q_sub.add_parser("list", help="List quarantine records")
    ql.add_argument("--client", required=True)
    ql.add_argument("--dataset", required=True)
    ql.set_defaults(func=cmd_quarantine_list)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
