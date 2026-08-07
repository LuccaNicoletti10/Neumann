"""Orquestração do fio de ouro: extract → sync → forecast → netting → schedule."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import polars as pl
import yaml
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from planner.core.db import get_session_factory
from planner.core.engine.explain import PlanExplanation, explain_plan_line
from planner.core.engine.forecast import generate_forecast, persist_forecast
from planner.core.engine.netting import NettingResult, calculate_net_requirements
from planner.core.engine.scheduler import (
    OrderCandidate,
    Schedule,
    SchedulingProblem,
    solve_schedule,
)
from planner.core.monitoring.alerts import (
    alert_connector_failure,
    alert_high_wmape,
    alert_pipeline_failure,
    alert_solver_infeasible,
)
from planner.core.ontology.sync_service import SyncService
from planner.core.pipeline.raw import RawLayer
from planner.core.pipeline.transform import Context, TransformRunner
from planner.plugins.csv_generic import CsvGenericConnector

logger = logging.getLogger(__name__)


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
    errors: list[str] = field(default_factory=list)


def run_plan(
    client: str,
    *,
    config_root: Path,
    data_root: Path,
    horizon_days: int = 30,
    dry_run: bool = False,
    session_factory: sessionmaker | None = None,
) -> PlanSummary:
    """
    Executa o ciclo completo de planejamento.

    Em falha de etapa: alerta, não emite plano parcial, propaga erro.
    --dry-run: calcula até o schedule sem gravar Postgres.
    """
    started = time.perf_counter()
    factory = session_factory or get_session_factory()
    snapshot_versions: dict[str, str] = {}
    summary = PlanSummary(plan_run_id=None, dry_run=dry_run)

    try:
        # 1) Extract
        t0 = time.perf_counter()
        logger.info("[%s] extract início", client)
        snapshot_versions.update(
            _step_extract(client, config_root, data_root)
        )
        logger.info("[%s] extract fim (%.2fs)", client, time.perf_counter() - t0)

        # 2) Transform
        t0 = time.perf_counter()
        logger.info("[%s] transform início", client)
        import planner.core.pipeline.transform  # noqa: F401

        ctx = Context.load(client, config_root, data_root)
        runner = TransformRunner(ctx, RawLayer(data_root))
        clean_paths = runner.run_all()
        for name, path in clean_paths.items():
            snapshot_versions[f"clean:{name}"] = str(path)
        logger.info("[%s] transform fim (%.2fs)", client, time.perf_counter() - t0)

        # 3) Sync
        t0 = time.perf_counter()
        logger.info("[%s] sync início", client)
        if not dry_run:
            _step_sync(client, clean_paths, ctx.run_id, factory)
        else:
            logger.info("[%s] sync pulado (--dry-run)", client)
        logger.info("[%s] sync fim (%.2fs)", client, time.perf_counter() - t0)

        # 4) Forecast
        t0 = time.perf_counter()
        logger.info("[%s] forecast início", client)
        sales = _load_sales_history(client, data_root, clean_paths, factory, dry_run)
        forecast_df = generate_forecast(sales, horizon_days=horizon_days)
        for row in forecast_df.to_dicts():
            wmape = float(row.get("wmape_backtest") or 0)
            if wmape > 0.5:
                alert_high_wmape(client, str(row["sku"]), wmape)
        if not dry_run and not forecast_df.is_empty():
            persist_forecast(forecast_df, session_factory=factory)
        logger.info("[%s] forecast fim (%.2fs)", client, time.perf_counter() - t0)

        # 5) Netting
        t0 = time.perf_counter()
        logger.info("[%s] netting início", client)
        products, inventory, open_orders, open_prod, bom, policies = _load_netting_inputs(
            client, data_root, clean_paths, factory, dry_run
        )
        netting = calculate_net_requirements(
            forecast_df,
            inventory,
            open_orders,
            open_prod,
            products,
            bom,
            policies,
        )
        summary.netting = netting
        logger.info("[%s] netting fim (%.2fs) skus=%s", client, time.perf_counter() - t0, len(netting))

        # 6) Schedule
        t0 = time.perf_counter()
        logger.info("[%s] schedule início", client)
        problem, schedule = _step_schedule(
            client, config_root, netting, products, horizon_days, factory
        )
        if schedule.solver_status.upper() == "INFEASIBLE":
            alert_solver_infeasible(client)
            raise RuntimeError("Solver INFEASIBLE — plano não emitido")
        summary.solver_status = schedule.solver_status
        summary.orders_created = len(schedule.assignments)
        summary.machines_allocated = len({a.machine_id for a in schedule.assignments})
        logger.info("[%s] schedule fim (%.2fs)", client, time.perf_counter() - t0)

        # 7) Explain
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

        # 8) Persist plan_run
        plan_run_id = str(uuid4())
        summary.plan_run_id = plan_run_id
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
            )
            logger.info("[%s] persist fim (%.2fs)", client, time.perf_counter() - t0)
        else:
            logger.info("[%s] persist pulado (--dry-run)", client)

        summary.duration_seconds = time.perf_counter() - started
        logger.info(
            "[%s] plano concluído orders=%s machines=%s status=%s duração=%.2fs dry_run=%s",
            client,
            summary.orders_created,
            summary.machines_allocated,
            summary.solver_status,
            summary.duration_seconds,
            dry_run,
        )
        return summary
    except Exception as exc:
        alert_pipeline_failure(client, exc)
        summary.errors.append(str(exc))
        summary.duration_seconds = time.perf_counter() - started
        raise


def _step_extract(client: str, config_root: Path, data_root: Path) -> dict[str, str]:
    sources_path = config_root / client / "sources.yaml"
    csv_path = data_root / client / "csv"
    if sources_path.exists():
        raw = yaml.safe_load(sources_path.read_text(encoding="utf-8")) or {}
        for src in raw.get("sources") or []:
            if src.get("type") == "csv_generic":
                cfg = src.get("config") or {}
                base = str(cfg.get("base_path", "")).replace("${DATA_ROOT}", str(data_root))
                if base:
                    csv_path = Path(base)

    connector = CsvGenericConnector(csv_path)
    if not connector.healthcheck():
        # fallback fixtures
        alt = data_root / client / "csv"
        connector = CsvGenericConnector(alt)
    if not connector.healthcheck():
        alert_connector_failure(client, connector.name, connector.retries)
        raise RuntimeError(f"Fonte CSV inacessível: {csv_path}")

    raw = RawLayer(data_root)
    run_id = datetime.now().strftime("%H%M%S")
    versions: dict[str, str] = {}
    try:
        for dataset in connector.list_datasets():
            df = connector.extract(dataset)
            path = raw.write_dataset(
                client,
                dataset,
                df,
                run_id=run_id,
                metadata={"connector": connector.name},
            )
            versions[f"raw:{dataset}"] = str(path)
    except Exception:
        alert_connector_failure(client, connector.name, connector.retries)
        raise
    return versions


def _step_sync(
    client: str,
    clean_paths: dict[str, Path],
    run_id: str,
    factory: sessionmaker,
) -> None:
    sync = SyncService(session_factory=factory)
    today = date.today()
    for output, path in clean_paths.items():
        df = pl.read_parquet(path)
        ref = f"{output}:{run_id}"
        name = output.lower()
        if "product" in name:
            sync.sync_products(client, df, source_ref=ref)
        elif "invent" in name or "stock" in name:
            sync.sync_inventory(client, df, snapshot_date=today, source_ref=ref)
        elif "sales" in name or "demand" in name:
            if "id" not in df.columns and "sku" in df.columns:
                df = df.with_columns(
                    (pl.col("sku").cast(pl.Utf8) + "-" + pl.col("date").cast(pl.Utf8)).alias("id")
                    if "date" in df.columns
                    else pl.col("sku").cast(pl.Utf8).alias("id")
                )
            sync.sync_demand(client, df, source_ref=ref)


def _load_sales_history(
    client: str,
    data_root: Path,
    clean_paths: dict[str, Path],
    factory: sessionmaker,
    dry_run: bool,
) -> pl.DataFrame:
    for key, path in clean_paths.items():
        if "sales" in key.lower() or "demand" in key.lower():
            df = pl.read_parquet(path)
            cols = {c.lower(): c for c in df.columns}
            if "sku" in cols and ("qty" in cols or "quantity" in cols) and "date" in cols:
                return df.rename(
                    {
                        cols["sku"]: "sku",
                        cols.get("qty", cols.get("quantity")): "qty",
                        cols["date"]: "date",
                    }
                ).select(["sku", "date", "qty"])

    # synthetic fallback from products (demo)
    products_path = None
    for key, path in clean_paths.items():
        if "product" in key.lower():
            products_path = path
            break
    if products_path is None:
        return pl.DataFrame({"sku": [], "date": [], "qty": []})

    products = pl.read_parquet(products_path)
    skus = products.get_column("sku").to_list() if "sku" in products.columns else []
    rows: list[dict[str, Any]] = []
    start = date.today() - timedelta(days=24 * 30)
    for sku in skus[:20]:
        for i in range(24 * 30):
            d = start + timedelta(days=i)
            # sazonalidade mensal + ruído determinístico
            qty = 10 + (d.month % 6) * 3 + (hash(f"{sku}-{d}") % 5)
            rows.append({"sku": sku, "date": d, "qty": float(qty)})
    return pl.DataFrame(rows)


def _load_netting_inputs(
    client: str,
    data_root: Path,
    clean_paths: dict[str, Path],
    factory: sessionmaker,
    dry_run: bool,
) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame, pl.DataFrame, pl.DataFrame, dict]:
    products = pl.DataFrame({"sku": [], "lead_time_days": [], "min_lot": [], "lot_multiple": []})
    inventory = pl.DataFrame({"sku": [], "available": []})
    for key, path in clean_paths.items():
        df = pl.read_parquet(path)
        if "product" in key.lower() and "sku" in df.columns:
            products = df
        if "invent" in key.lower() or "stock" in key.lower():
            inventory = df

    if products.is_empty():
        # mínimo para não quebrar o motor em demo
        products = pl.DataFrame(
            {
                "sku": ["DEMO-1"],
                "family": ["DEFAULT"],
                "lead_time_days": [7],
                "min_lot": [1.0],
                "lot_multiple": [1.0],
            }
        )
    if "family" not in products.columns:
        products = products.with_columns(pl.lit("DEFAULT").alias("family"))
    if inventory.is_empty() and "sku" in products.columns:
        inventory = products.select(["sku"]).with_columns(pl.lit(0.0).alias("available"))

    empty_oo = pl.DataFrame({"sku": [], "qty": []})
    empty_op = pl.DataFrame({"sku": [], "qty_planned": [], "qty_produced": []})
    bom = pl.DataFrame({"parent_sku": [], "component_sku": [], "qty_per_unit": []})
    policies = {"service_level_z": 1.645, "min_days_of_cover": 12, "default_lead_time_days": 10}
    return products, inventory, empty_oo, empty_op, bom, policies


def _step_schedule(
    client: str,
    config_root: Path,
    netting: list[NettingResult],
    products: pl.DataFrame,
    horizon_days: int,
    factory: sessionmaker | None = None,
) -> tuple[SchedulingProblem, Schedule]:
    family_map = {}
    if "sku" in products.columns and "family" in products.columns:
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

    today = date.today()
    horizon_end = today + timedelta(days=horizon_days)

    if not orders:
        problem = SchedulingProblem(
            orders=[],
            compatibility=_empty_compatibility(),
            setup_matrix=_empty_setup_matrix(),
            calendar=_empty_calendar(),
            horizon_start=today,
            horizon_end=horizon_end,
        )
        return problem, Schedule(solver_status="FEASIBLE")

    compatibility, setup_matrix, calendar, source = _load_schedule_frames(
        client=client,
        config_root=config_root,
        orders=orders,
        today=today,
        horizon_days=horizon_days,
        factory=factory,
    )
    if source != "postgres":
        logger.warning(
            "[%s] schedule usando dados %s (Postgres sem machines/compatibility)",
            client,
            source,
        )
    else:
        logger.info("[%s] schedule carregado do Postgres", client)

    problem = SchedulingProblem(
        orders=orders,
        compatibility=compatibility,
        setup_matrix=setup_matrix,
        calendar=calendar,
        horizon_start=today,
        horizon_end=horizon_end,
    )
    schedule = solve_schedule(problem, time_limit_s=10)
    return problem, schedule


def _load_schedule_frames(
    *,
    client: str,
    config_root: Path,
    orders: list[OrderCandidate],
    today: date,
    horizon_days: int,
    factory: sessionmaker | None,
) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame, str]:
    """Carrega compatibility/setup/calendar: Postgres → YAML → sintético."""
    if factory is not None:
        try:
            frames = _load_schedule_from_postgres(factory, orders, today, horizon_days)
            if frames is not None:
                return (*frames, "postgres")
        except Exception as exc:
            logger.warning("[%s] falha ao ler schedule do Postgres: %s", client, exc)

    yaml_frames = _load_schedule_from_yaml(config_root, client, orders, today, horizon_days)
    if yaml_frames is not None:
        return (*yaml_frames, "yaml")

    return (*_synthetic_schedule_frames(orders, today, horizon_days), "synthetic")


def machines_to_polars(rows: list[Any]) -> pl.DataFrame:
    """Converte MachineModel → Polars."""
    if not rows:
        return pl.DataFrame(
            {
                "id": [],
                "work_center_id": [],
                "name": [],
                "hours_per_day": [],
                "shifts": [],
                "efficiency": [],
            }
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
    """Converte CompatibilityModel → Polars."""
    if not rows:
        return _empty_compatibility()
    return pl.DataFrame(
        [
            {
                "sku": r.sku,
                "machine_id": r.machine_id,
                "speed_units_per_hour": r.speed_units_per_hour,
            }
            for r in rows
        ]
    )


def setup_matrix_to_polars(rows: list[Any]) -> pl.DataFrame:
    """Converte SetupMatrixModel → Polars."""
    if not rows:
        return _empty_setup_matrix()
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


def build_calendar_from_machines(
    machines: pl.DataFrame,
    start: date,
    horizon_days: int,
    maintenance_hours: dict[str, float] | None = None,
) -> pl.DataFrame:
    """
    Calendar diário a partir de hours_per_day × shifts × efficiency.

    Subtrai horas de manutenção por máquina quando informadas.
    """
    maintenance_hours = maintenance_hours or {}
    if machines.is_empty():
        return _empty_calendar()

    rows: list[dict[str, Any]] = []
    for m in machines.to_dicts():
        mid = str(m["id"])
        hours = float(m.get("hours_per_day") or 8.0)
        shifts = float(m.get("shifts") or 1)
        eff = float(m.get("efficiency") or 1.0)
        base = hours * shifts * max(eff, 0.0)
        maint = float(maintenance_hours.get(mid, 0.0))
        for d in range(horizon_days + 1):
            day = start + timedelta(days=d)
            available = max(base - (maint if d == 0 else 0.0), 0.0)
            rows.append(
                {"machine_id": mid, "date": day, "available_hours": available}
            )
    return pl.DataFrame(rows)


def _load_schedule_from_postgres(
    factory: sessionmaker,
    orders: list[OrderCandidate],
    today: date,
    horizon_days: int,
) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame] | None:
    from sqlalchemy import select

    from planner.core.ontology.db_models import (
        CompatibilityModel,
        MachineModel,
        SetupMatrixModel,
    )

    try:
        session = factory()
    except Exception:
        return None

    try:
        machines = list(session.execute(select(MachineModel)).scalars().all())
        compat_rows = list(session.execute(select(CompatibilityModel)).scalars().all())
        setup_rows = list(session.execute(select(SetupMatrixModel)).scalars().all())
    except Exception:
        return None
    finally:
        try:
            session.close()
        except Exception:
            pass

    # rejeita mocks / resultados inválidos
    if machines and not isinstance(machines[0], MachineModel):
        return None
    if compat_rows and not isinstance(compat_rows[0], CompatibilityModel):
        return None
    if not machines and not compat_rows:
        return None

    machines_df = machines_to_polars(machines)
    compatibility = compatibility_to_polars(compat_rows)
    setup_matrix = setup_matrix_to_polars(setup_rows)

    # restringe compatibility aos SKUs do plano
    order_skus = [o.sku for o in orders]
    if not compatibility.is_empty() and "sku" in compatibility.columns:
        filtered = compatibility.filter(pl.col("sku").is_in(order_skus))
        if not filtered.is_empty():
            compatibility = filtered
        else:
            # Postgres tem outras famílias — cai para fallback externo
            return None

    # se compatibility vazia, deriva fallback dos SKUs × primeira máquina
    if compatibility.is_empty() and not machines_df.is_empty():
        mid = machines_df["id"][0]
        compatibility = pl.DataFrame(
            {
                "sku": order_skus,
                "machine_id": [mid] * len(orders),
                "speed_units_per_hour": [100.0] * len(orders),
            }
        )
    if setup_matrix.is_empty():
        setup_matrix = pl.DataFrame(
            {
                "machine_id": [machines_df["id"][0]] if not machines_df.is_empty() else ["M01"],
                "from_family": ["DEFAULT"],
                "to_family": ["DEFAULT"],
                "setup_minutes": [15.0],
                "forbidden": [False],
            }
        )

    calendar = build_calendar_from_machines(machines_df, today, horizon_days)
    if calendar.is_empty():
        mids = (
            compatibility.get_column("machine_id").unique().to_list()
            if not compatibility.is_empty()
            else ["M01"]
        )
        calendar = pl.DataFrame(
            {
                "machine_id": mids,
                "date": [today] * len(mids),
                "available_hours": [16.0] * len(mids),
            }
        )
    return compatibility, setup_matrix, calendar


def _load_schedule_from_yaml(
    config_root: Path,
    client: str,
    orders: list[OrderCandidate],
    today: date,
    horizon_days: int,
) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame] | None:
    rules_dir = config_root / client / "rules"
    if not rules_dir.exists():
        return None

    compat_path = rules_dir / "compatibility.yaml"
    setups_path = rules_dir / "setups.yaml"
    if not compat_path.exists() and not setups_path.exists():
        return None

    compatibility = _empty_compatibility()
    if compat_path.exists():
        raw = yaml.safe_load(compat_path.read_text(encoding="utf-8")) or {}
        rows = raw if isinstance(raw, list) else (raw.get("compatibility") or raw.get("rows") or [])
        if rows:
            compatibility = pl.DataFrame(rows)

    setup_matrix = _empty_setup_matrix()
    if setups_path.exists():
        raw = yaml.safe_load(setups_path.read_text(encoding="utf-8")) or {}
        rows = raw if isinstance(raw, list) else (raw.get("setups") or raw.get("matrix") or [])
        if rows:
            setup_matrix = pl.DataFrame(rows)

    # filtra compatibility aos SKUs do plano quando possível
    skus = {o.sku for o in orders}
    if not compatibility.is_empty() and "sku" in compatibility.columns:
        filtered = compatibility.filter(pl.col("sku").is_in(list(skus)))
        if not filtered.is_empty():
            compatibility = filtered

    if compatibility.is_empty():
        return None

    mids = compatibility.get_column("machine_id").unique().to_list()
    machines_df = pl.DataFrame(
        {
            "id": mids,
            "work_center_id": ["WC1"] * len(mids),
            "name": mids,
            "hours_per_day": [8.0] * len(mids),
            "shifts": [2] * len(mids),
            "efficiency": [0.9] * len(mids),
        }
    )
    calendar = build_calendar_from_machines(machines_df, today, horizon_days)
    if setup_matrix.is_empty():
        setup_matrix = pl.DataFrame(
            {
                "machine_id": [mids[0]],
                "from_family": ["DEFAULT"],
                "to_family": ["DEFAULT"],
                "setup_minutes": [15.0],
                "forbidden": [False],
            }
        )
    return compatibility, setup_matrix, calendar


def _synthetic_schedule_frames(
    orders: list[OrderCandidate], today: date, horizon_days: int
) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    skus = [o.sku for o in orders]
    compatibility = pl.DataFrame(
        {
            "sku": skus,
            "machine_id": ["M01"] * len(skus),
            "speed_units_per_hour": [100.0] * len(skus),
        }
    )
    setup_matrix = pl.DataFrame(
        {
            "machine_id": ["M01"],
            "from_family": ["DEFAULT"],
            "to_family": ["DEFAULT"],
            "setup_minutes": [15.0],
            "forbidden": [False],
        }
    )
    machines_df = pl.DataFrame(
        {
            "id": ["M01"],
            "work_center_id": ["WC1"],
            "name": ["Tear 1"],
            "hours_per_day": [8.0],
            "shifts": [2],
            "efficiency": [0.9],
        }
    )
    calendar = build_calendar_from_machines(machines_df, today, horizon_days)
    return compatibility, setup_matrix, calendar


def _empty_compatibility() -> pl.DataFrame:
    return pl.DataFrame({"sku": [], "machine_id": [], "speed_units_per_hour": []})


def _empty_setup_matrix() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "machine_id": [],
            "from_family": [],
            "to_family": [],
            "setup_minutes": [],
            "forbidden": [],
        }
    )


def _empty_calendar() -> pl.DataFrame:
    return pl.DataFrame({"machine_id": [], "date": [], "available_hours": []})


def _persist_plan_run(
    factory: sessionmaker,
    *,
    plan_run_id: str,
    client: str,
    snapshot_versions: dict[str, str],
    solver_status: str,
    objective: float,
    duration_seconds: float,
) -> None:
    import json

    session = factory()
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
                "versions": json.dumps(snapshot_versions),
                "status": solver_status,
                "objective": objective,
                "duration": duration_seconds,
            },
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
