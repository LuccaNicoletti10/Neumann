"""Teste E2E do fio de ouro: plan completo com fixtures test_client."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from planner.core.engine.plan_pipeline import run_plan
from planner.core.ontology.db_models import (
    CompatibilityModel,
    MachineModel,
    SetupMatrixModel,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "test_client"


def _database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://planner:planner@localhost:5432/planner"
    )


def _postgres_ready() -> bool:
    try:
        engine = create_engine(_database_url(), future=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1 FROM ontology.product LIMIT 1"))
            conn.execute(text("SELECT 1 FROM decisions.plan_run LIMIT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


@pytest.mark.integration
@pytest.mark.skipif(not _postgres_ready(), reason="PostgreSQL indisponível")
def test_plan_e2e_test_client(tmp_path: Path):
    """
    Roda plan completo (não dry-run) para popular ontology + decisions.

    Verifica: produtos syncados, forecast, plan_run, duração < 60s.
    """
    client = "test_client"
    data_root = tmp_path / "data"
    csv_dir = data_root / client / "csv"
    csv_dir.mkdir(parents=True)
    for name in (
        "products.csv",
        "sales.csv",
        "inventory.csv",
        "machines.csv",
        "compatibility.csv",
        "setup_matrix.csv",
    ):
        shutil.copy(FIXTURES / name, csv_dir / name)

    config_root = ROOT / "config"
    assert (config_root / client / "mappings" / "products.yaml").exists()

    engine = create_engine(_database_url(), future=True)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    # seed machines/compatibility/setup no Postgres (ainda sem sync dedicado)
    _seed_schedule_ontology(factory)

    # cleanup prévio do cliente
    session = factory()
    try:
        session.execute(text("DELETE FROM ontology.product WHERE sku LIKE 'SKU00%'"))
        session.execute(text("DELETE FROM decisions.forecast WHERE sku LIKE 'SKU00%'"))
        session.execute(text("DELETE FROM decisions.plan_run WHERE client = :c"), {"c": client})
        session.commit()
    finally:
        session.close()

    started = time.perf_counter()
    summary = run_plan(
        client,
        config_root=config_root,
        data_root=data_root,
        horizon_days=14,
        dry_run=False,
        session_factory=factory,
    )
    elapsed = time.perf_counter() - started

    assert not summary.errors
    assert summary.plan_run_id
    assert summary.solver_status
    assert elapsed < 60

    session = factory()
    try:
        products = session.execute(
            text("SELECT COUNT(*) FROM ontology.product WHERE sku LIKE 'SKU00%'")
        ).scalar()
        forecasts = session.execute(
            text("SELECT COUNT(*) FROM decisions.forecast WHERE sku LIKE 'SKU00%'")
        ).scalar()
        plans = session.execute(
            text("SELECT COUNT(*) FROM decisions.plan_run WHERE client = :c"),
            {"c": client},
        ).scalar()
    finally:
        session.close()
        engine.dispose()

    assert products >= 5
    assert forecasts >= 1
    assert plans >= 1


def _seed_schedule_ontology(factory: sessionmaker) -> None:
    session = factory()
    try:
        for mid, wc, name in [
            ("M01", "WC1", "Tear 1"),
            ("M02", "WC1", "Tear 2"),
            ("M03", "WC2", "Tear 3"),
        ]:
            session.execute(
                pg_insert(MachineModel)
                .values(
                    id=mid,
                    work_center_id=wc,
                    name=name,
                    hours_per_day=8.0,
                    shifts=2,
                    efficiency=0.9,
                    props={},
                )
                .on_conflict_do_update(
                    index_elements=["id"],
                    set_={"name": name, "hours_per_day": 8.0, "shifts": 2, "efficiency": 0.9},
                )
            )
        pairs = [
            ("SKU001", "M01", 100.0),
            ("SKU001", "M02", 90.0),
            ("SKU002", "M01", 95.0),
            ("SKU003", "M02", 80.0),
            ("SKU004", "M03", 120.0),
            ("SKU005", "M03", 70.0),
        ]
        for sku, mid, spd in pairs:
            session.execute(
                pg_insert(CompatibilityModel)
                .values(sku=sku, machine_id=mid, speed_units_per_hour=spd)
                .on_conflict_do_update(
                    index_elements=["sku", "machine_id"],
                    set_={"speed_units_per_hour": spd},
                )
            )
        for mid in ("M01", "M02", "M03"):
            session.execute(
                pg_insert(SetupMatrixModel)
                .values(
                    machine_id=mid,
                    from_family="CLA",
                    to_family="CLA",
                    setup_minutes=20.0,
                    forbidden=False,
                )
                .on_conflict_do_nothing()
            )
        session.commit()
    finally:
        session.close()
