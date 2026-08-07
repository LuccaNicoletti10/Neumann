"""Testes de forecast com histórico sintético de 24 meses."""

from __future__ import annotations

from datetime import date, timedelta

import polars as pl
import pytest

from planner.core.engine.forecast import generate_forecast


def _synthetic_sales(months: int = 24) -> pl.DataFrame:
    rows: list[dict] = []
    start = date(2024, 1, 1)
    for sku in ("SKU-A", "SKU-B"):
        for m in range(months * 30):
            d = start + timedelta(days=m)
            # sazonalidade + tendência leve
            qty = 20 + 5 * (d.month % 6) + (m // 30)
            rows.append({"sku": sku, "date": d, "qty": float(qty)})
    return pl.DataFrame(rows)


@pytest.mark.unit
def test_generate_forecast_synthetic_24_months():
    history = _synthetic_sales(24)
    out = generate_forecast(
        history,
        horizon_days=30,
        backtest_until=date(2025, 12, 31),
    )
    assert not out.is_empty()
    assert set(out.columns) >= {"sku", "month", "qty", "model", "wmape_backtest"}
    assert out.height == 2
    assert (out["qty"] >= 0).all()
    assert out["model"].null_count() == 0


@pytest.mark.unit
def test_generate_forecast_empty():
    empty = pl.DataFrame({"sku": [], "date": [], "qty": []})
    out = generate_forecast(empty)
    assert out.is_empty()
    assert "wmape_backtest" in out.columns
