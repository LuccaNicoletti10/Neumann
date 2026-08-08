"""CLI do Neumann Planner — ontologia, pipeline, build, timetravel e ingestão."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def _paths(client: str) -> dict[str, Path]:
    # Preferência: planner/config (estrutura canônica); fallback: config/ na raiz
    planner_config = ROOT / "planner" / "config"
    root_config = ROOT / "config"
    config_root = planner_config if (planner_config / client).exists() else root_config
    return {
        "core": root_config / "core" / "ontology",
        "overrides": config_root / client / "ontology_overrides.yaml",
        "mappings": config_root / client / "mappings",
        "fixtures": ROOT / "fixtures" / client,
        "data": ROOT / "data",
        "config": config_root,
    }


def _boot_ontology(client: str, version: str = "1.0.0"):
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
    ctx = _boot_ontology(args.client)
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
    for msg in report.messages or ["(sem diferenças)"]:
        print(f"  - {msg}")
    return 0


def cmd_ontology_publish(args: argparse.Namespace) -> int:
    from planner.core.ontology.repository import OntologyRepository
    from planner.core.ontology.versioning import OntologyVersionService

    ctx = _boot_ontology(args.client, version=args.version)
    service = OntologyVersionService(ctx["registry"], OntologyRepository())
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
    print(f"Published {published.client}@{published.version} ({published.status.value})")
    return 0


def cmd_parse_property(args: argparse.Namespace) -> int:
    ctx = _boot_ontology(args.client)
    snap = ctx["snapshot"]
    prop = ctx["registry"].get_property(args.object, args.property, snap.version_id)
    result = ctx["parser_engine"].parse_property(prop.id, args.value, snap.version_id)
    print(f"Raw value: {args.value}")
    print(f"Property: {args.object}.{args.property}")
    print(f"Ontology: {snap.semantic_version}")
    print(f"Parser: {result.parser_id}")
    print(f"Canonical value: {result.canonical_value}")
    print(f"Status: {result.status.value}")
    print(f"Validation: {'passed' if result.ok else 'failed'}")
    return 0 if result.ok else 1


def cmd_ingest(args: argparse.Namespace) -> int:
    from planner.core.ingestion.result import IngestionContext

    ctx = _boot_ontology(args.client)
    schema = ctx["mappings"].get(args.dataset)
    if not schema:
        print(f"Dataset desconhecido: {args.dataset}", file=sys.stderr)
        return 1
    fixture = Path(args.file) if args.file else ctx["paths"]["fixtures"] / schema.source_dataset
    # fallback produtos.csv
    if not fixture.exists():
        alt = ctx["paths"]["fixtures"] / "produtos.csv"
        fixture = alt if alt.exists() else fixture
    if not fixture.exists():
        print(f"Fixture não encontrada: {fixture}", file=sys.stderr)
        return 1
    with fixture.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    context = IngestionContext(
        client=args.client,
        run_id=str(uuid4()),
        ontology_version_id=ctx["snapshot"].version_id,
        dataset=args.dataset,
        dry_run=args.dry_run,
        max_error_rate=args.max_error_rate,
    )
    report = ctx["ingestion"].ingest_rows(rows, schema, context)
    print(f"Total={report.total} accepted={report.accepted} quarantined={report.quarantined}")
    return 0


def cmd_quarantine_list(args: argparse.Namespace) -> int:
    from planner.core.ingestion.result import IngestionContext

    ctx = _boot_ontology(args.client)
    schema = ctx["mappings"].get(args.dataset)
    if schema:
        fixture = ctx["paths"]["fixtures"] / "produtos.csv"
        if fixture.exists():
            with fixture.open(newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            ctx["ingestion"].ingest_rows(
                rows,
                schema,
                IngestionContext(
                    client=args.client,
                    run_id=str(uuid4()),
                    ontology_version_id=ctx["snapshot"].version_id,
                    dataset=args.dataset,
                    dry_run=True,
                ),
            )
    for rec in ctx["quarantine"].list(client=args.client, dataset=args.dataset):
        print(json.dumps({
            "source_ref": rec.source_ref,
            "error_code": rec.error_code,
            "error_message": rec.error_message,
            "status": rec.status.value,
        }, ensure_ascii=False))
    return 0


def cmd_extract(args: argparse.Namespace) -> int:
    from planner.core.pipeline.raw import RawLayer, new_run_id
    from planner.plugins.csv_generic import CsvGenericConnector

    data_root = Path(args.data_root)
    csv_path = data_root / args.client / "csv"
    connector = CsvGenericConnector(csv_path)
    if not connector.healthcheck():
        # fallback fixtures
        csv_path = ROOT / "data" / args.client / "csv"
        connector = CsvGenericConnector(csv_path)
    if not connector.healthcheck():
        print(f"Fonte CSV inacessível: {csv_path}", file=sys.stderr)
        return 1

    raw = RawLayer(data_root)
    run_id = new_run_id()
    for dataset in connector.list_datasets():
        df = connector.extract(dataset)
        path = raw.write_dataset(
            args.client,
            dataset,
            df,
            run_id=f"{run_id}_{dataset}",
            metadata={"connector": connector.name},
        )
        print(f"RAW {dataset}: {df.height} rows → {path}")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from planner.core.ontology.sync_service import SyncService
    from planner.core.pipeline.raw import RawLayer
    from planner.core.pipeline.transform import Context, TransformRunner
    import planner.core.pipeline.transform  # noqa: F401 — registra @transform

    data_root = Path(args.data_root)
    config_root = _paths(args.client)["config"]
    # Se config está em planner/config, o parent do client dir é o config root
    ctx = Context.load(args.client, config_root, data_root)
    runner = TransformRunner(ctx, RawLayer(data_root))
    paths = runner.run_all()
    for output, path in paths.items():
        print(f"BUILD {output} → {path}")

    # Sync funnel
    import polars as pl

    sync = SyncService()
    for output, path in paths.items():
        if output.endswith("products"):
            df = pl.read_parquet(path)
            # filter invalid units before sync if any
            result = sync.sync_products(args.client, df, source_ref=f"{output}:{ctx.run_id}")
            print(
                f"SYNC products inserted={result.inserted} updated={result.updated} "
                f"ignored={result.ignored} errors={len(result.errors)}"
            )
    return 0


def cmd_timetravel(args: argparse.Namespace) -> int:
    from planner.core.pipeline.timetravel import print_timetravel

    on_date = date.fromisoformat(args.date)
    print_timetravel(Path(args.data_root), args.client, args.dataset, on_date)
    return 0


def cmd_lineage(args: argparse.Namespace) -> int:
    from planner.core.pipeline.timetravel import show_lineage

    rows = show_lineage(Path(args.data_root), args.client, args.dataset, args.version)
    if not rows:
        print("Sem lineage encontrado")
        return 0
    for row in rows:
        print(json.dumps(row, ensure_ascii=False))
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    from planner.core.ontology.sync_service import SyncService
    import polars as pl

    # tenta ler clean products
    data_root = Path(args.data_root)
    clean = data_root / args.client / "clean" / "products"
    files = sorted(clean.glob("snapshot_date=*/run_*.parquet")) if clean.exists() else []
    sync = SyncService()
    if files:
        sync.sync_products(args.client, pl.read_parquet(files[-1]), source_ref=str(files[-1]))
    obj = sync.get_object(args.object, args.key)
    if not obj:
        print(f"{args.object} {args.key} não encontrado", file=sys.stderr)
        return 1
    payload = obj.__dict__
    if args.format == "json":
        print(json.dumps(payload, default=str, indent=2, ensure_ascii=False))
    else:
        print(f"{args.object}::{args.key}")
        for k, v in payload.items():
            print(f"  {k}: {v}")
    return 0


def cmd_schedule(args: argparse.Namespace) -> int:
    """Batch diário: ciclo completo (ou só extract+build com --extract-only)."""
    if getattr(args, "extract_only", False):
        print(f"[scheduler] client={args.client} extract+build")
        ns = argparse.Namespace(client=args.client, data_root=args.data_root)
        rc = cmd_extract(ns)
        if rc != 0:
            return rc
        return cmd_build(ns)
    if getattr(args, "daemon", False):
        from planner.core.engine.daily_job import start_scheduler

        start_scheduler()
        return 0
    from planner.core.engine.daily_job import run_daily_plan
    import os

    os.environ["PLANNER_CLIENT"] = args.client
    os.environ["PLANNER_DATA_ROOT"] = str(args.data_root)
    run_daily_plan(args.client)
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    """Fio de ouro: extract → transform → sync → forecast → netting → schedule → explain."""
    from planner.core.engine.plan_pipeline import run_plan

    paths = _paths(args.client)
    data_root = Path(args.data_root)
    try:
        summary = run_plan(
            args.client,
            config_root=paths["config"],
            data_root=data_root,
            horizon_days=args.horizon,
            dry_run=args.dry_run,
            mode=args.mode,
            emergency_greedy=args.emergency_greedy,
        )
    except Exception as exc:
        print(f"ERRO no plan: {exc}", file=sys.stderr)
        return 1

    print(f"client={args.client}")
    print(f"mode={summary.mode}")
    print(f"plan_run_id={summary.plan_run_id}")
    print(f"orders_created={summary.orders_created}")
    print(f"machines_allocated={summary.machines_allocated}")
    print(f"solver_status={summary.solver_status}")
    print(f"objective={summary.objective}")
    print(f"duration_seconds={summary.duration_seconds:.2f}")
    print(f"dry_run={summary.dry_run}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="planner", description="Neumann Planner CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    ont = sub.add_parser("ontology", help="Ontologia dinâmica")
    ont_sub = ont.add_subparsers(dest="ontology_command", required=True)
    v = ont_sub.add_parser("validate")
    v.add_argument("--client", required=True)
    v.set_defaults(func=cmd_ontology_validate)
    d = ont_sub.add_parser("diff")
    d.add_argument("--client", required=True)
    d.add_argument("--from", dest="from_version", required=True)
    d.add_argument("--to", dest="to_version", required=True)
    d.set_defaults(func=cmd_ontology_diff)
    p = ont_sub.add_parser("publish")
    p.add_argument("--client", required=True)
    p.add_argument("--version", required=True)
    p.set_defaults(func=cmd_ontology_publish)

    pp = sub.add_parser("parse-property")
    pp.add_argument("--client", required=True)
    pp.add_argument("--object", required=True)
    pp.add_argument("--property", required=True)
    pp.add_argument("--value", required=True)
    pp.set_defaults(func=cmd_parse_property)

    ing = sub.add_parser("ingest")
    ing.add_argument("--client", required=True)
    ing.add_argument("--dataset", required=True)
    ing.add_argument("--file")
    ing.add_argument("--dry-run", action="store_true")
    ing.add_argument("--max-error-rate", type=float, default=0.5)
    ing.set_defaults(func=cmd_ingest)

    q = sub.add_parser("quarantine")
    q_sub = q.add_subparsers(dest="quarantine_command", required=True)
    ql = q_sub.add_parser("list")
    ql.add_argument("--client", required=True)
    ql.add_argument("--dataset", required=True)
    ql.set_defaults(func=cmd_quarantine_list)

    ex = sub.add_parser("extract", help="Extrai fontes → RAW parquet")
    ex.add_argument("--client", required=True)
    ex.add_argument("--data-root", default=str(ROOT / "data"))
    ex.set_defaults(func=cmd_extract)

    b = sub.add_parser("build", help="Roda transforms clean + sync")
    b.add_argument("--client", required=True)
    b.add_argument("--data-root", default=str(ROOT / "data"))
    b.set_defaults(func=cmd_build)

    tt = sub.add_parser("timetravel")
    tt.add_argument("--client", required=True)
    tt.add_argument("--dataset", required=True)
    tt.add_argument("--date", required=True)
    tt.add_argument("--data-root", default=str(ROOT / "data"))
    tt.set_defaults(func=cmd_timetravel)

    lin = sub.add_parser("lineage")
    lin.add_argument("--client", required=True)
    lin.add_argument("--dataset", required=True)
    lin.add_argument("--version", required=True)
    lin.add_argument("--data-root", default=str(ROOT / "data"))
    lin.set_defaults(func=cmd_lineage)

    sh = sub.add_parser("show")
    sh.add_argument("--client", required=True)
    sh.add_argument("--object", required=True)
    sh.add_argument("--key", required=True)
    sh.add_argument("--format", choices=["text", "json"], default="text")
    sh.add_argument("--data-root", default=str(ROOT / "data"))
    sh.set_defaults(func=cmd_show)

    sch = sub.add_parser("schedule", help="Batch diário (ciclo completo ou daemon APScheduler)")
    sch.add_argument("--client", required=True)
    sch.add_argument("--data-root", default=str(ROOT / "data"))
    sch.add_argument("--extract-only", action="store_true", help="Só extract+build")
    sch.add_argument("--daemon", action="store_true", help="Agenda APScheduler (bloqueia)")
    sch.set_defaults(func=cmd_schedule)

    pln = sub.add_parser("plan", help="Ciclo completo extract→schedule→explain")
    pln.add_argument("--client", required=True)
    pln.add_argument("--horizon", type=int, default=30)
    pln.add_argument("--dry-run", action="store_true")
    pln.add_argument("--mode", choices=["demo", "operational"], default="operational")
    pln.add_argument(
        "--emergency-greedy",
        action="store_true",
        help="Usa heurística gulosa explicitamente (marca HEURISTIC_*)",
    )
    pln.add_argument("--data-root", default=str(ROOT / "data"))
    pln.set_defaults(func=cmd_plan)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
