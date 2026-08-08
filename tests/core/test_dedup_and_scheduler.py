"""Testes de deduplicação por chave de dataset e scheduler (setup/calendário)."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import polars as pl
import pytest

from planner.core.engine.scheduler import (
    OrderCandidate,
    SchedulingProblem,
    calendar_windows,
    solve_schedule,
)
from planner.core.errors import DedupConflictError
from planner.core.pipeline.transform import _dedup


@pytest.mark.unit
def test_dedup_keeps_compatibility_multi_machine():
    df = pl.DataFrame(
        {
            "sku": ["A", "A"],
            "machine_id": ["M1", "M2"],
            "speed_units_per_hour": [100.0, 90.0],
        }
    )
    out = _dedup(df, keys=["sku", "machine_id"], mode="operational", dataset="clean.compatibility")
    assert out.height == 2


@pytest.mark.unit
def test_dedup_products_by_sku_only():
    df = pl.DataFrame({"sku": ["A", "A"], "family": ["F1", "F1"], "unit": ["kg", "kg"]})
    out = _dedup(df, keys=["sku"], mode="operational", dataset="clean.products")
    assert out.height == 1


@pytest.mark.unit
def test_dedup_conflict_raises_operational():
    df = pl.DataFrame({"sku": ["A", "A"], "family": ["F1", "F2"], "unit": ["kg", "kg"]})
    with pytest.raises(DedupConflictError):
        _dedup(df, keys=["sku"], mode="operational", dataset="clean.products")


@pytest.mark.unit
def test_dedup_inventory_by_location():
    df = pl.DataFrame(
        {
            "sku": ["A", "A"],
            "snapshot_date": [date(2026, 1, 1), date(2026, 1, 1)],
            "location": ["L1", "L2"],
            "available": [10.0, 20.0],
        }
    )
    out = _dedup(
        df,
        keys=["sku", "snapshot_date", "location"],
        mode="operational",
        dataset="clean.inventory",
    )
    assert out.height == 2


@pytest.mark.unit
def test_calendar_windows_skips_zero_days():
    cal = pl.DataFrame(
        {
            "machine_id": ["M1", "M1"],
            "date": [date(2026, 1, 7), date(2026, 1, 8)],
            "available_hours": [0.0, 8.0],
        }
    )
    wins = calendar_windows(cal, date(2026, 1, 7), date(2026, 1, 10))
    assert wins["M1"] == [(24 * 60, 24 * 60 + 8 * 60)]


@pytest.mark.unit
def test_ortools_respects_forbidden_setup():
    """Duas famílias, uma máquina, F1→F2 forbidden → INFEASIBLE se ambas precisam da máquina."""
    orders = [
        OrderCandidate("O1", "SKU1", "F1", 10, 10, date(2026, 1, 10)),
        OrderCandidate("O2", "SKU2", "F2", 10, 10, date(2026, 1, 10)),
    ]
    compat = pl.DataFrame(
        {
            "sku": ["SKU1", "SKU2"],
            "machine_id": ["M1", "M1"],
            "speed_units_per_hour": [60.0, 60.0],
        }
    )
    setup = pl.DataFrame(
        {
            "machine_id": ["M1", "M1"],
            "from_family": ["F1", "F2"],
            "to_family": ["F2", "F1"],
            "setup_minutes": [30.0, 30.0],
            "forbidden": [True, True],
        }
    )
    cal = pl.DataFrame(
        {
            "machine_id": ["M1"] * 5,
            "date": [date(2026, 1, 1) + timedelta(days=i) for i in range(5)],
            "available_hours": [8.0] * 5,
        }
    )
    problem = SchedulingProblem(
        orders=orders,
        compatibility=compat,
        setup_matrix=setup,
        calendar=cal,
        horizon_start=date(2026, 1, 1),
        horizon_end=date(2026, 1, 5),
    )
    schedule = solve_schedule(problem, time_limit_s=5, seed=1)
    assert schedule.solver_status == "INFEASIBLE"


@pytest.mark.unit
def test_ortools_setup_time_and_sequence_known_optimum():
    """3 ordens, 2 máquinas — transição permitida com setup; total bate a sequência."""
    orders = [
        OrderCandidate("A", "S1", "F1", 60, 5, date(2026, 1, 10)),  # 60 min @ 60/h
        OrderCandidate("B", "S2", "F2", 60, 5, date(2026, 1, 10)),
        OrderCandidate("C", "S3", "F1", 60, 5, date(2026, 1, 10)),
    ]
    compat = pl.DataFrame(
        {
            "sku": ["S1", "S1", "S2", "S2", "S3", "S3"],
            "machine_id": ["M1", "M2", "M1", "M2", "M1", "M2"],
            "speed_units_per_hour": [60.0] * 6,
        }
    )
    setup = pl.DataFrame(
        {
            "machine_id": ["M1", "M1", "M2", "M2"],
            "from_family": ["F1", "F2", "F1", "F2"],
            "to_family": ["F2", "F1", "F2", "F1"],
            "setup_minutes": [45.0, 45.0, 45.0, 45.0],
            "forbidden": [False, False, False, False],
        }
    )
    cal = pl.DataFrame(
        {
            "machine_id": ["M1"] * 7 + ["M2"] * 7,
            "date": [date(2026, 1, 1) + timedelta(days=i) for i in range(7)] * 2,
            "available_hours": [16.0] * 14,
        }
    )
    problem = SchedulingProblem(
        orders=orders,
        compatibility=compat,
        setup_matrix=setup,
        calendar=cal,
        horizon_start=date(2026, 1, 1),
        horizon_end=date(2026, 1, 7),
    )
    schedule = solve_schedule(problem, time_limit_s=10, seed=42)
    assert schedule.solver_status in {"OPTIMAL", "FEASIBLE"}
    assert len(schedule.assignments) == 3
    # setup_time_total deve refletir a sequência real
    by_m: dict[str, list] = {}
    for a in schedule.assignments:
        by_m.setdefault(a.machine_id, []).append(a)
    expected = 0
    fam = {"A": "F1", "B": "F2", "C": "F1"}
    for _m, items in by_m.items():
        items.sort(key=lambda x: x.start)
        prev = None
        for a in items:
            if prev and prev != fam[a.order_id]:
                expected += 45
            prev = fam[a.order_id]
    assert schedule.setup_time_total == expected


@pytest.mark.unit
def test_schedule_not_on_zero_capacity_day():
    orders = [OrderCandidate("O1", "SKU1", "F1", 10, 10, date(2026, 1, 10))]
    compat = pl.DataFrame(
        {"sku": ["SKU1"], "machine_id": ["M1"], "speed_units_per_hour": [60.0]}
    )
    setup = pl.DataFrame(
        {
            "machine_id": [],
            "from_family": [],
            "to_family": [],
            "setup_minutes": [],
            "forbidden": [],
        }
    ).cast(
        {
            "machine_id": pl.Utf8,
            "from_family": pl.Utf8,
            "to_family": pl.Utf8,
            "setup_minutes": pl.Float64,
            "forbidden": pl.Boolean,
        }
    )
    cal = pl.DataFrame(
        {
            "machine_id": ["M1", "M1"],
            "date": [date(2026, 1, 7), date(2026, 1, 8)],
            "available_hours": [0.0, 8.0],
        }
    )
    problem = SchedulingProblem(
        orders=orders,
        compatibility=compat,
        setup_matrix=setup,
        calendar=cal,
        horizon_start=date(2026, 1, 7),
        horizon_end=date(2026, 1, 9),
    )
    schedule = solve_schedule(problem, time_limit_s=5, seed=1)
    assert schedule.solver_status in {"OPTIMAL", "FEASIBLE"}
    assert len(schedule.assignments) == 1
    start = schedule.assignments[0].start
    assert start.date() == date(2026, 1, 8)
    assert start != datetime.combine(date(2026, 1, 7), datetime.min.time())
