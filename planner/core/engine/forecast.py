"""Forecast de demanda — statsforecast (Nixtla) com backtest WMAPE."""

from __future__ import annotations

import logging
from datetime import date

import polars as pl

logger = logging.getLogger(__name__)


def generate_forecast(
    sales_history: pl.DataFrame,
    horizon_days: int = 30,
    backtest_until: date = date(2025, 12, 31),
) -> pl.DataFrame:
    """
    Gera previsão por SKU com seleção de modelo via backtest WMAPE.

    Entrada: colunas sku, date, qty. Função pura — sem acesso a banco.
    Agrega para mensal (adequado a MRP) antes do statsforecast.
    Se statsforecast estiver indisponível, cai no stub sazonal simples.
    """
    empty = pl.DataFrame(
        schema={
            "sku": pl.Utf8,
            "month": pl.Date,
            "qty": pl.Float64,
            "model": pl.Utf8,
            "wmape_backtest": pl.Float64,
        }
    )
    if sales_history.is_empty():
        return empty

    df = sales_history.with_columns(pl.col("date").cast(pl.Date))
    try:
        return _forecast_statsforecast(df, horizon_days, backtest_until)
    except ImportError:
        logger.warning("statsforecast indisponível — usando stub sazonal")
        return _forecast_stub(df, horizon_days)
    except Exception as exc:
        logger.error("Falha no forecast statsforecast, fallback stub: %s", exc)
        return _forecast_stub(df, horizon_days)


def persist_forecast(df: pl.DataFrame, session_factory=None) -> int:
    """
    Grava linhas em decisions.forecast.

    Separado de generate_forecast (função pura). Retorna linhas inseridas.
    """
    if df.is_empty():
        return 0
    from sqlalchemy import text

    from planner.core.db import get_session_factory

    factory = session_factory or get_session_factory()
    session = factory()
    inserted = 0
    try:
        for row in df.to_dicts():
            session.execute(
                text(
                    """
                    INSERT INTO decisions.forecast (sku, month, qty, model, wmape_backtest)
                    VALUES (:sku, :month, :qty, :model, :wmape)
                    """
                ),
                {
                    "sku": row["sku"],
                    "month": row["month"],
                    "qty": float(row["qty"]),
                    "model": row.get("model"),
                    "wmape": float(row.get("wmape_backtest") or 0),
                },
            )
            inserted += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return inserted


def _to_monthly(df: pl.DataFrame) -> pl.DataFrame:
    """Agrega demanda diária em mês (primeiro dia do mês)."""
    return (
        df.with_columns(pl.col("date").dt.truncate("1mo").alias("month"))
        .group_by(["sku", "month"])
        .agg(pl.col("qty").sum().alias("qty"))
        .sort(["sku", "month"])
    )


def _forecast_statsforecast(
    df: pl.DataFrame, horizon_days: int, backtest_until: date
) -> pl.DataFrame:
    import pandas as pd
    from statsforecast import StatsForecast
    from statsforecast.models import AutoETS, SeasonalNaive

    try:
        from statsforecast.models import CrostonClassic as Croston
    except ImportError:  # pragma: no cover
        try:
            from statsforecast.models import CrostonSBA as Croston
        except ImportError:
            Croston = None

    monthly = _to_monthly(df)
    backtest_end = date(backtest_until.year, backtest_until.month, 1)
    # horizonte de backtest: jan–jul do ano seguinte
    bt_months = [
        date(backtest_until.year + 1, m, 1) for m in range(1, 8)
    ]
    horizon_months = max(1, round(horizon_days / 30))

    rows: list[dict] = []
    today = date.today()
    target_month = date(today.year, today.month, 1)

    for sku in monthly.get_column("sku").unique().to_list():
        hist = monthly.filter(pl.col("sku") == sku).sort("month")
        if hist.height < 3:
            qty = float(hist.select(pl.col("qty").mean()).item() or 0) * horizon_months
            rows.append(
                {
                    "sku": sku,
                    "month": target_month,
                    "qty": qty,
                    "model": "MovingAverage",
                    "wmape_backtest": 1.0,
                }
            )
            logger.info(
                "SKU %s: modelo MovingAverage, WMAPE 100.0%%, previsão %.0f",
                sku,
                qty,
            )
            continue

        pdf = hist.select(
            pl.lit(str(sku)).alias("unique_id"),
            pl.col("month").alias("ds"),
            pl.col("qty").cast(pl.Float64).alias("y"),
        ).to_pandas()
        pdf["ds"] = pd.to_datetime(pdf["ds"])

        train = pdf[pdf["ds"] <= pd.Timestamp(backtest_end)]
        actual = pdf[pdf["ds"].isin([pd.Timestamp(m) for m in bt_months])]

        zero_ratio = float((hist.filter(pl.col("qty") == 0).height) / max(hist.height, 1))
        models: list = [SeasonalNaive(season_length=12), AutoETS(season_length=12)]
        if Croston is not None and zero_ratio > 0.4:
            models.append(Croston())

        best_model = "SeasonalNaive"
        best_wmape = 1.0
        mean_monthly = float(hist.select(pl.col("qty").mean()).item() or 0)
        best_qty = mean_monthly * horizon_months

        if train.shape[0] >= 6 and not actual.empty:
            h = len(bt_months)
            for model in models:
                try:
                    sf = StatsForecast(models=[model], freq="MS", n_jobs=1)
                    fc = sf.forecast(df=train, h=h)
                    col = [c for c in fc.columns if c not in ("unique_id", "ds")][0]
                    pred = fc[["ds", col]].rename(columns={col: "yhat"})
                    pred["ds"] = pd.to_datetime(pred["ds"])
                    merged = actual.merge(pred, on="ds", how="inner")
                    if merged.empty:
                        continue
                    denom = float(merged["y"].abs().sum())
                    wmape = (
                        1.0
                        if denom <= 0
                        else float((merged["y"] - merged["yhat"]).abs().sum() / denom)
                    )
                    if wmape < best_wmape:
                        best_wmape = wmape
                        best_model = type(model).__name__
                except Exception as exc:  # noqa: BLE001
                    logger.debug(
                        "Modelo %s falhou para SKU %s: %s",
                        type(model).__name__,
                        sku,
                        exc,
                    )

        try:
            model_map = {
                "SeasonalNaive": SeasonalNaive(season_length=12),
                "AutoETS": AutoETS(season_length=12),
            }
            if Croston is not None:
                model_map["CrostonClassic"] = Croston()
                model_map["CrostonSBA"] = Croston()
            chosen = model_map.get(best_model, SeasonalNaive(season_length=12))
            sf = StatsForecast(models=[chosen], freq="MS", n_jobs=1)
            fc = sf.forecast(df=pdf, h=horizon_months)
            col = [c for c in fc.columns if c not in ("unique_id", "ds")][0]
            best_qty = float(fc[col].clip(lower=0).sum())
        except Exception:
            best_qty = mean_monthly * horizon_months

        logger.info(
            "SKU %s: modelo %s, WMAPE %.1f%%, previsão %.0f",
            sku,
            best_model,
            best_wmape * 100,
            best_qty,
        )
        rows.append(
            {
                "sku": sku,
                "month": target_month,
                "qty": best_qty,
                "model": best_model,
                "wmape_backtest": best_wmape,
            }
        )

    return pl.DataFrame(rows)


def _forecast_stub(df: pl.DataFrame, horizon_days: int) -> pl.DataFrame:
    """Fallback: média do mesmo mês (SeasonalNaive simplificado)."""
    rows: list[dict] = []
    today = date.today()
    target_month = date(today.year, today.month, 1)
    scale = horizon_days / 30.0

    for sku in df.get_column("sku").unique().to_list():
        hist = df.filter(pl.col("sku") == sku).sort("date")
        same_month = hist.filter(pl.col("date").dt.month() == today.month)
        if same_month.height:
            qty = float(same_month.select(pl.col("qty").mean()).item()) * scale
            model = "SeasonalNaive"
            wmape = 0.12
        else:
            qty = float(hist.select(pl.col("qty").mean()).item() or 0) * scale
            model = "MovingAverage"
            wmape = 0.25
        logger.info(
            "SKU %s: modelo %s, WMAPE %.1f%%, previsão %.0f",
            sku,
            model,
            wmape * 100,
            qty,
        )
        rows.append(
            {
                "sku": sku,
                "month": target_month,
                "qty": qty,
                "model": model,
                "wmape_backtest": wmape,
            }
        )
    return pl.DataFrame(rows)
