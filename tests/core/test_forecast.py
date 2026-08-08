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
        reference_date=date(2026, 8, 1),
    )
    assert not out.is_empty()
    assert set(out.columns) >= {"sku", "month", "qty", "model", "wmape_backtest"}
    assert out.height == 2
    assert (out["qty"] >= 0).all()
    assert out["model"].null_count() == 0


@pytest.mark.unit
def test_generate_forecast_operational_no_stub_without_statsforecast(monkeypatch):
    from planner.core.errors import ForecastError
    from planner.core.engine import forecast as forecast_mod

    def boom(*_a, **_k):
        raise ImportError("no statsforecast")

    monkeypatch.setattr(forecast_mod, "_forecast_statsforecast", boom)
    history = _synthetic_sales(6)
    with pytest.raises(ForecastError):
        generate_forecast(history, mode="operational", reference_date=date(2026, 1, 15))


@pytest.mark.unit
def test_generate_forecast_demo_allows_stub(monkeypatch):
    from planner.core.engine import forecast as forecast_mod

    def boom(*_a, **_k):
        raise ImportError("no statsforecast")

    monkeypatch.setattr(forecast_mod, "_forecast_statsforecast", boom)
    history = _synthetic_sales(6)
    out = generate_forecast(history, mode="demo", reference_date=date(2026, 1, 15))
    assert not out.is_empty()
    assert "status" in out.columns

