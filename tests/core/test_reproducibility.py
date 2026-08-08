"""Teste de reprodutibilidade determinística do plano."""

from __future__ import annotations

import shutil
from datetime import date
from pathlib import Path

import pytest

from planner.core.engine.plan_pipeline import run_plan

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "test_client"


@pytest.mark.unit
def test_plan_reproducible_same_seed(tmp_path: Path):
    client = "test_client"
    config_root = ROOT / "config"
    ref = date(2026, 8, 1)

    def _run(base: Path):
        data_root = base / "data"
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
        return run_plan(
            client,
            config_root=config_root,
            data_root=data_root,
            horizon_days=14,
            dry_run=True,
            mode="operational",
            emergency_greedy=True,
            solver_seed=42,
            reference_date=ref,
        )

    a = _run(tmp_path / "a")
    b = _run(tmp_path / "b")

    assert a.orders_created == b.orders_created
    assert a.machines_allocated == b.machines_allocated
    assert a.solver_status == b.solver_status
    assert a.objective == b.objective

    exp_a = [(e.order, e.sku, e.qty, e.machine, e.window) for e in a.explanations]
    exp_b = [(e.order, e.sku, e.qty, e.machine, e.window) for e in b.explanations]
    assert exp_a == exp_b
