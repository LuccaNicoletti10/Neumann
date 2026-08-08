"""Orquestração do fio de ouro — modos demo | operational."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

import polars as pl
import yaml
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from planner.core.db import get_session_factory
from planner.core.engine.decision_log import DecisionLogService
from planner.core.engine.explain import PlanExplanation, explain_plan_line
from planner.core.engine.forecast import generate_forecast, persist_forecast
from planner.core.engine.netting import NettingResult, calculate_net_requirements
from planner.core.engine.scheduler import (
    OrderCandidate,
    Schedule,
    SchedulingProblem,
    solve_schedule,
)
from planner.core.engine.version import ENGINE_VERSION, SOLVER_DEFAULT, SOLVER_EMERGENCY
from planner.core.errors import (
    InvalidDatasetError,
    MissingDatasetError,
    SyncCriticalError,
)
from planner.core.monitoring.alerts import (
    alert_connector_failure,
    alert_high_wmape,
    alert_pipeline_failure,
    alert_solver_infeasible,
)
from planner.core.ontology.sync_service import SyncResult, SyncService
from planner.core.pipeline.raw import RawLayer, new_run_id
from planner.core.pipeline.transform import Context, TransformRunner
from planner.plugins.csv_generic import CsvGenericConnector

logger = logging.getLogger(__name__)

PlanMode = Literal["demo", "operational"]

REQUIRED_CLEAN = (
    "clean.products",
    "clean.sales",
    "clean.inventory",
    "clean.machines",
    "clean.compatibility",
    "clean.setup_matrix",
)


@dataclass
class PlanSummary:
    """Resumo do ciclo plan para CLI e testes."""

    plan_run_id: str | None
    orders_created: int = 0
    machines_allocated: int = 0
    solver_status: str = "UNKNOWN"
    duration_seconds: float = 0.0
    explanations: list[PlanExplanation] = field(default_factory=list)
    netting: list[NettingResult] = field(default_factory=list)
    dry_run: bool = False
    mode: str = "operational"
    input_versions: dict[str, Any] = field(default_factory=dict)
    objective: float = 0.0
    errors: list[str] = field(default_factory=list)


def run_plan(
    client: str,
    *,
    config_root: Path,
    data_root: Path,
    horizon_days: int = 30,
    dry_run: bool = False,
    mode: PlanMode = "operational",
    session_factory: sessionmaker | None = None,
    reference_date: date | None = None,
    solver: str = SOLVER_DEFAULT,
    solver_seed: int = 42,
    emergency_greedy: bool = False,
) -> PlanSummary:
    """
    Executa o ciclo completo de planejamento.

    mode=operational → falha se faltar dado obrigatório (nunca inventa).
    mode=demo → permite ausências com WARNING explícito (ainda sem inventar vendas).
    """
    started = time.perf_counter()
    factory = session_factory or get_session_factory()
    ref = reference_date or date.today()
    summary = PlanSummary(plan_run_id=None, dry_run=dry_run, mode=mode)
    run_id = new_run_id()
    snapshot_versions: dict[str, Any] = {
        "engine_version": ENGINE_VERSION,
        "mode": mode,
        "horizon_days": horizon_days,
        "reference_date": ref.isoformat(),
        "solver": SOLVER_EMERGENCY if emergency_greedy else solver,
        "solver_seed": solver_seed,
        "datasets": {},
        "config_checksum": _config_checksum(config_root, client),
    }

    try:
        t0 = time.perf_counter()
        logger.info("[%s] extract início mode=%s", client, mode)
        snapshot_versions["datasets"].update(
            _step_extract(client, config_root, data_root, factory, run_id)
        )
        logger.info("[%s] extract fim (%.2fs)", client, time.perf_counter() - t0)

        t0 = time.perf_counter()
        logger.info("[%s] transform início", client)
        import planner.core.pipeline.transform  # noqa: F401

        ctx = Context.load(
            client,
            config_root,
            data_root,
            run_id=run_id,
            mode=mode,
            session_factory=factory,
        )
        runner = TransformRunner(ctx, RawLayer(data_root, session_factory=factory))
        clean_paths = runner.run_all()
        for name, path in clean_paths.items():
            snap = {
                "path": str(path),
                "checksum": _file_sha256(Path(path)),
                "run_id": run_id,
            }
            snapshot_versions["datasets"][name] = snap
        _assert_required_clean(clean_paths, mode)
        logger.info("[%s] transform fim (%.2fs)", client, time.perf_counter() - t0)

        t0 = time.perf_counter()
        logger.info("[%s] sync início", client)
        if not dry_run:
            sync_results = _step_sync(client, clean_paths, run_id, factory)
            _assert_sync_ok(sync_results)
        else:
            logger.info("[%s] sync pulado (--dry-run)", client)
        logger.info("[%s] sync fim (%.2fs)", client, time.perf_counter() - t0)

        t0 = time.perf_counter()
        logger.info("[%s] forecast início", client)
        sales = _require_clean_df(clean_paths, "clean.sales", "sales")
        forecast_df = generate_forecast(
            sales,
            horizon_days=horizon_days,
            reference_date=ref,
        )
        for row in forecast_df.to_dicts():
            wmape = float(row.get("wmape_backtest") or 0)
            if wmape > 0.5:
                alert_high_wmape(client, str(row["sku"]), wmape)
        if not dry_run and not forecast_df.is_empty():
            persist_forecast(
                forecast_df,
                session_factory=factory,
                client=client,
                forecast_run_id=run_id,
                reference_date=ref,
                horizon_days=horizon_days,
            )
        logger.info("[%s] forecast fim (%.2fs)", client, time.perf_counter() - t0)

        t0 = time.perf_counter()
        logger.info("[%s] netting início", client)
        products, inventory, open_orders, open_prod, bom, policies = _load_netting_inputs(
            client, config_root, clean_paths, mode
        )
        sales_hist = sales.select(["sku", "date", "qty"]) if "date" in sales.columns else sales
        netting = calculate_net_requirements(
            forecast_df,
            inventory,
            open_orders,
            open_prod,
            products,
            bom,
            policies,
            sales_history=sales_hist,
            today=ref,
        )
        summary.netting = netting
        logger.info("[%s] netting fim (%.2fs) skus=%s", client, time.perf_counter() - t0, len(netting))

        t0 = time.perf_counter()
        logger.info("[%s] schedule início", client)
        problem, schedule = _step_schedule(
            client,
            config_root,
            netting,
            products,
            horizon_days,
            clean_paths,
            mode,
            factory,
            ref,
            emergency_greedy=emergency_greedy,
            solver_seed=solver_seed,
        )
        if schedule.solver_status.upper() == "INFEASIBLE":
            alert_solver_infeasible(client)
            raise RuntimeError("Solver INFEASIBLE — plano não emitido")
        summary.solver_status = schedule.solver_status
        summary.orders_created = len(schedule.assignments)
        summary.machines_allocated = len({a.machine_id for a in schedule.assignments})
        summary.objective = schedule.objective_value
        logger.info("[%s] schedule fim (%.2fs)", client, time.perf_counter() - t0)

        t0 = time.perf_counter()
        logger.info("[%s] explain início", client)
        net_by_sku = {n.sku: n for n in netting}
        explanations: list[PlanExplanation] = []
        for assignment in schedule.assignments:
            order = next(o for o in problem.orders if o.id == assignment.order_id)
            nr = net_by_sku.get(order.sku) or NettingResult(
                sku=order.sku,
                net_requirement=order.qty,
                suggested_qty=order.qty,
                suggested_date=order.deadline,
                reason="sem netting",
            )
            explanations.append(explain_plan_line(assignment, problem, nr))
        summary.explanations = explanations
        logger.info("[%s] explain fim (%.2fs)", client, time.perf_counter() - t0)

        plan_run_id = str(uuid4())
        summary.plan_run_id = plan_run_id
        summary.input_versions = snapshot_versions
        if not dry_run:
            t0 = time.perf_counter()
            logger.info("[%s] persist início", client)
            _persist_plan_run(
                factory,
                plan_run_id=plan_run_id,
                client=client,
                snapshot_versions=snapshot_versions,
                solver_status=schedule.solver_status,
                objective=schedule.objective_value,
                duration_seconds=time.perf_counter() - started,
                schedule=schedule,
                explanations=explanations,
                problem=problem,
                netting=netting,
            )
            logger.info("[%s] persist fim (%.2fs)", client, time.perf_counter() - t0)
        else:
            logger.info("[%s] persist pulado (--dry-run)", client)

        summary.duration_seconds = time.perf_counter() - started
        logger.info(
            "[%s] plano concluído orders=%s machines=%s status=%s duração=%.2fs mode=%s",
            client,
            summary.orders_created,
            summary.machines_allocated,
            summary.solver_status,
            summary.duration_seconds,
            mode,
        )
        return summary
    except Exception as exc:
        alert_pipeline_failure(client, exc)
        summary.errors.append(str(exc))
        summary.duration_seconds = time.perf_counter() - started
        raise


def _assert_required_clean(clean_paths: dict[str, str], mode: PlanMode) -> None:
    missing = [name for name in REQUIRED_CLEAN if name not in clean_paths]
    if not missing:
        return
    if mode == "operational":
        raise MissingDatasetError(missing[0], f"obrigatórios ausentes: {missing}")
    for name in missing:
        logger.warning("DEMO: dataset ausente %s — plano pode ficar incompleto", name)


def _assert_sync_ok(results: list[SyncResult]) -> None:
    for r in results:
        if r.errors:
            raise SyncCriticalError("; ".join(r.errors))


def _require_clean_df(clean_paths: dict[str, str], key: str, label: str) -> pl.DataFrame:
    path = clean_paths.get(key)
    if not path:
        # tenta alias sem prefixo
        alt = key.split(".", 1)[-1]
        for k, v in clean_paths.items():
            if k.endswith(alt):
                path = v
                break
    if not path:
        raise MissingDatasetError(key, f"{label} não encontrado")
    df = pl.read_parquet(path)
    if df.is_empty():
        raise InvalidDatasetError(key, f"{label} vazio")
    return df


def _step_extract(
    client: str,
    config_root: Path,
    data_root: Path,
    factory: sessionmaker,
    run_id: str,
) -> dict[str, Any]:
    sources_path = config_root / client / "sources.yaml"
    csv_path = data_root / client / "csv"
    if sources_path.exists():
        raw_cfg = yaml.safe_load(sources_path.read_text(encoding="utf-8")) or {}
        for src in raw_cfg.get("sources") or []:
            if src.get("type") == "csv_generic":
                cfg = src.get("config") or {}
                base = str(cfg.get("base_path", "")).replace("${DATA_ROOT}", str(data_root))
                if base:
                    csv_path = Path(base)

    connector = CsvGenericConnector(csv_path)
    if not connector.healthcheck():
        alert_connector_failure(client, connector.name, connector.retries)
        raise MissingDatasetError("csv_source", f"Fonte CSV inacessível: {csv_path}")

    raw = RawLayer(data_root, session_factory=factory)
    versions: dict[str, Any] = {}
    try:
        for dataset in connector.list_datasets():
            df = connector.extract(dataset)
            # run_id único por dataset para evitar colisão append-only
            ds_run = f"{run_id}_{dataset}"
            path = raw.write_dataset(
                client,
                dataset,
                df,
                run_id=ds_run,
                metadata={"connector": connector.name},
            )
            versions[f"raw:{dataset}"] = {
                "path": str(path),
                "checksum": _file_sha256(Path(path)),
                "run_id": ds_run,
                "rows": df.height,
            }
    except Exception:
        alert_connector_failure(client, connector.name, connector.retries)
        raise
    return versions


def _step_sync(
    client: str,
    clean_paths: dict[str, Path | str],
    run_id: str,
    factory: sessionmaker,
) -> list[SyncResult]:
    sync = SyncService(session_factory=factory)
    today = date.today()
    results: list[SyncResult] = []
    for output, path in clean_paths.items():
        df = pl.read_parquet(path)
        ref = f"{output}:{run_id}"
        name = output.lower()
        if "product" in name:
            results.append(sync.sync_products(client, df, source_ref=ref))
        elif "invent" in name or "stock" in name:
            if "snapshot_date" not in df.columns:
                raise InvalidDatasetError("clean.inventory", "inventory sem snapshot válido")
            results.append(sync.sync_inventory(client, df, snapshot_date=today, source_ref=ref))
        elif "sales" in name or "demand" in name:
            results.append(sync.sync_demand(client, df, source_ref=ref))
    return results


def _load_netting_inputs(
    client: str,
    config_root: Path,
    clean_paths: dict[str, str],
    mode: PlanMode,
) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame, pl.DataFrame, pl.DataFrame, dict]:
    products = _require_clean_df(clean_paths, "clean.products", "products")
    inventory = _require_clean_df(clean_paths, "clean.inventory", "inventory")
    if "snapshot_date" not in inventory.columns:
        raise InvalidDatasetError("clean.inventory", "inventory sem snapshot válido")

    open_orders = _optional_clean(clean_paths, "clean.open_orders", ["sku", "qty"])
    open_prod = _optional_clean(
        clean_paths, "clean.production_orders", ["sku", "qty_planned", "qty_produced"]
    )
    bom = _optional_clean(clean_paths, "clean.bom", ["parent_sku", "component_sku", "qty_per_unit"])

    policies_path = config_root / client / "rules" / "policies.yaml"
    if not policies_path.exists():
        if mode == "operational":
            raise MissingDatasetError("policies.yaml", "políticas do cliente não encontradas")
        logger.warning("DEMO: policies.yaml ausente — usando defaults documentados")
        policies = {
            "service_level_z": 1.645,
            "min_days_of_cover": 12,
            "default_lead_time_days": 10,
        }
    else:
        policies = yaml.safe_load(policies_path.read_text(encoding="utf-8")) or {}

    if "family" not in products.columns:
        raise InvalidDatasetError("clean.products", "família obrigatória")
    return products, inventory, open_orders, open_prod, bom, policies


def _optional_clean(
    clean_paths: dict[str, str], key: str, columns: list[str]
) -> pl.DataFrame:
    path = clean_paths.get(key)
    if not path:
        return pl.DataFrame({c: [] for c in columns})
    return pl.read_parquet(path)


def _step_schedule(
    client: str,
    config_root: Path,
    netting: list[NettingResult],
    products: pl.DataFrame,
    horizon_days: int,
    clean_paths: dict[str, str],
    mode: PlanMode,
    factory: sessionmaker | None,
    today: date,
    *,
    emergency_greedy: bool,
    solver_seed: int,
) -> tuple[SchedulingProblem, Schedule]:
    family_map = dict(zip(products["sku"].to_list(), products["family"].to_list()))
    orders: list[OrderCandidate] = []
    for i, n in enumerate(netting):
        if n.suggested_qty <= 0:
            continue
        orders.append(
            OrderCandidate(
                id=f"ORD-{i+1:04d}",
                sku=n.sku,
                family=str(family_map.get(n.sku) or "DEFAULT"),
                qty=n.suggested_qty,
                priority=max(n.net_requirement, 1.0),
                deadline=n.suggested_date,
            )
        )

    horizon_end = today + timedelta(days=horizon_days)
    if not orders:
        problem = SchedulingProblem(
            orders=[],
            compatibility=_empty_compat(),
            setup_matrix=_empty_setup(),
            calendar=_empty_calendar(),
            horizon_start=today,
            horizon_end=horizon_end,
        )
        return problem, Schedule(solver_status="FEASIBLE", objective_value=0.0)

    compatibility = _require_clean_df(clean_paths, "clean.compatibility", "compatibility")
    setup_matrix = _require_clean_df(clean_paths, "clean.setup_matrix", "setup_matrix")
    machines = _require_clean_df(clean_paths, "clean.machines", "machines")

    # calendar: clean.machine_calendar ou derivado de machines
    if "clean.machine_calendar" in clean_paths:
        calendar = pl.read_parquet(clean_paths["clean.machine_calendar"])
    else:
        machines_df = machines
        if "id" not in machines_df.columns and "machine_id" in machines_df.columns:
            machines_df = machines_df.rename({"machine_id": "id"})
        calendar = build_calendar_from_machines(machines_df, today, horizon_days)

    if calendar.is_empty():
        raise MissingDatasetError("calendário de máquinas", "machine_calendar vazio")

    # filtra compatibility aos SKUs do plano
    order_skus = [o.sku for o in orders]
    compatibility = compatibility.filter(pl.col("sku").is_in(order_skus))
    for o in orders:
        if compatibility.filter(pl.col("sku") == o.sku).is_empty():
            raise RuntimeError(
                f"INFEASIBLE: SKU {o.sku} sem máquina compatível"
            )

    problem = SchedulingProblem(
        orders=orders,
        compatibility=compatibility,
        setup_matrix=setup_matrix,
        calendar=calendar,
        horizon_start=today,
        horizon_end=horizon_end,
    )
    schedule = solve_schedule(
        problem,
        time_limit_s=10,
        emergency_greedy=emergency_greedy,
        seed=solver_seed,
    )
    return problem, schedule


def build_calendar_from_machines(
    machines: pl.DataFrame,
    start: date,
    horizon_days: int,
    maintenance_hours: dict[str, float] | None = None,
) -> pl.DataFrame:
    """Calendar diário a partir de hours_per_day × shifts × efficiency."""
    maintenance_hours = maintenance_hours or {}
    if machines.is_empty():
        return _empty_calendar()
    id_col = "id" if "id" in machines.columns else "machine_id"
    rows: list[dict[str, Any]] = []
    for m in machines.to_dicts():
        mid = str(m[id_col])
        hours = float(m.get("hours_per_day") or 8.0)
        shifts = float(m.get("shifts") or 1)
        eff = float(m.get("efficiency") or 1.0)
        base = hours * shifts * max(eff, 0.0)
        maint = float(maintenance_hours.get(mid, 0.0))
        for d in range(horizon_days + 1):
            day = start + timedelta(days=d)
            available = max(base - (maint if d == 0 else 0.0), 0.0)
            rows.append({"machine_id": mid, "date": day, "available_hours": available})
    return pl.DataFrame(rows)


def machines_to_polars(rows: list[Any]) -> pl.DataFrame:
    if not rows:
        return pl.DataFrame(
            {"id": [], "work_center_id": [], "name": [], "hours_per_day": [], "shifts": [], "efficiency": []}
        )
    return pl.DataFrame(
        [
            {
                "id": r.id,
                "work_center_id": r.work_center_id,
                "name": r.name,
                "hours_per_day": r.hours_per_day,
                "shifts": r.shifts,
                "efficiency": r.efficiency,
            }
            for r in rows
        ]
    )


def compatibility_to_polars(rows: list[Any]) -> pl.DataFrame:
    if not rows:
        return _empty_compat()
    return pl.DataFrame(
        [{"sku": r.sku, "machine_id": r.machine_id, "speed_units_per_hour": r.speed_units_per_hour} for r in rows]
    )


def setup_matrix_to_polars(rows: list[Any]) -> pl.DataFrame:
    if not rows:
        return _empty_setup()
    return pl.DataFrame(
        [
            {
                "machine_id": r.machine_id,
                "from_family": r.from_family,
                "to_family": r.to_family,
                "setup_minutes": r.setup_minutes,
                "forbidden": bool(r.forbidden),
            }
            for r in rows
        ]
    )


def _empty_compat() -> pl.DataFrame:
    return pl.DataFrame({"sku": [], "machine_id": [], "speed_units_per_hour": []})


def _empty_setup() -> pl.DataFrame:
    return pl.DataFrame(
        {"machine_id": [], "from_family": [], "to_family": [], "setup_minutes": [], "forbidden": []}
    )


def _empty_calendar() -> pl.DataFrame:
    return pl.DataFrame({"machine_id": [], "date": [], "available_hours": []})


def _persist_plan_run(
    factory: sessionmaker,
    *,
    plan_run_id: str,
    client: str,
    snapshot_versions: dict[str, Any],
    solver_status: str,
    objective: float,
    duration_seconds: float,
    schedule: Schedule,
    explanations: list[PlanExplanation],
    problem: SchedulingProblem,
    netting: list[NettingResult],
) -> None:
    session = factory()
    decision_log = DecisionLogService(session_factory=factory)
    try:
        session.execute(
            text(
                """
                INSERT INTO decisions.plan_run
                    (id, client, created_at, input_snapshot_versions, solver_status,
                     objective, duration_seconds)
                VALUES
                    (:id, :client, :created_at, CAST(:versions AS jsonb), :status,
                     :objective, :duration)
                """
            ),
            {
                "id": plan_run_id,
                "client": client,
                "created_at": datetime.now(timezone.utc),
                "versions": json.dumps(snapshot_versions, default=str),
                "status": solver_status,
                "objective": objective,
                "duration": duration_seconds,
            },
        )
        # plan_line se a tabela existir
        try:
            for a in schedule.assignments:
                order = next(o for o in problem.orders if o.id == a.order_id)
                exp = next((e for e in explanations if e.order == a.order_id), None)
                session.execute(
                    text(
                        """
                        INSERT INTO decisions.plan_line
                            (id, client, plan_run_id, sku, family, qty, machine_id,
                             start_ts, end_ts, priority, deadline, status, explanation, created_at)
                        VALUES
                            (:id, :client, :plan_run_id, :sku, :family, :qty, :machine_id,
                             :start_ts, :end_ts, :priority, :deadline, 'proposed',
                             CAST(:explanation AS jsonb), :created_at)
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "client": client,
                        "plan_run_id": plan_run_id,
                        "sku": order.sku,
                        "family": order.family,
                        "qty": a.qty,
                        "machine_id": a.machine_id,
                        "start_ts": a.start,
                        "end_ts": a.end,
                        "priority": order.priority,
                        "deadline": order.deadline,
                        "explanation": json.dumps(
                            {
                                "reasons": [
                                    {"type": r.type, "message": r.message, "data": r.data}
                                    for r in (exp.reasons if exp else [])
                                ]
                            },
                            default=str,
                        ),
                        "created_at": datetime.now(timezone.utc),
                    },
                )
                decision_log.record_recommendation(
                    UUID(plan_run_id),
                    a.order_id,
                    a.qty,
                    a.machine_id,
                    client=client,
                    family=order.family,
                )
        except Exception as exc:
            logger.warning("plan_line/decision_log parcial: %s", exc)

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _config_checksum(config_root: Path, client: str) -> str:
    root = config_root / client
    if not root.exists():
        return ""
    h = hashlib.sha256()
    for path in sorted(root.rglob("*.yaml")):
        h.update(path.read_bytes())
    return h.hexdigest()


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
