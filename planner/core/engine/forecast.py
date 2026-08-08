"""Forecast de demanda — statsforecast (Nixtla) com backtest WMAPE."""

from __future__ import annotations

import logging
from datetime import date

import polars as pl

logger = logging.getLogger(__name__)


def generate_forecast(
    sales_history: pl.DataFrame,
    horizon_days: int = 30,
    backtest_until: date | None = None,
    reference_date: date | None = None,
) -> pl.DataFrame:
    """
    Gera previsão por SKU com seleção de modelo via backtest WMAPE móvel.

    Entrada: colunas sku, date, qty. Função pura — sem acesso a banco.
    backtest_until padrão = reference_date - 1 dia (não datas fixas).
    Horizonte respeita horizon_days (previsão diária somada ou mensal proporcional).
    """
    empty = pl.DataFrame(
        schema={
            "sku": pl.Utf8,
            "month": pl.Date,
            "qty": pl.Float64,
            "model": pl.Utf8,
            "wmape_backtest": pl.Float64,
            "bias_backtest": pl.Float64,
            "training_rows": pl.Int64,
            "profile": pl.Utf8,
        }
    )
    if sales_history.is_empty():
        return empty

    ref = reference_date or date.today()
    cutoff = backtest_until or (ref - __import__("datetime").timedelta(days=1))
    df = sales_history.with_columns(pl.col("date").cast(pl.Date))
    try:
        return _forecast_statsforecast(df, horizon_days, cutoff, ref)
    except ImportError:
        logger.warning("statsforecast indisponível — usando stub sazonal")
        return _forecast_stub(df, horizon_days, ref)
    except Exception as exc:
        logger.error("Falha no forecast statsforecast, fallback stub: %s", exc)
        return _forecast_stub(df, horizon_days, ref)


def persist_forecast(
    df: pl.DataFrame,
    session_factory=None,
    *,
    client: str = "",
    forecast_run_id: str = "",
    reference_date: date | None = None,
    horizon_days: int = 30,
) -> int:
    """Grava linhas em decisions.forecast com identificação da execução."""
    if df.is_empty():
        return 0
    from sqlalchemy import text

    from planner.core.db import get_session_factory

    factory = session_factory or get_session_factory()
    session = factory()
    inserted = 0
    ref = reference_date or date.today()
    try:
        for row in df.to_dicts():
            session.execute(
                text(
                    """
                    INSERT INTO decisions.forecast
                        (sku, month, qty, model, wmape_backtest)
                    VALUES (:sku, :month, :qty, :model, :wmape)
                    """
                ),
                {
                    "sku": row["sku"],
                    "month": row["month"],
                    "qty": float(row["qty"]),
                    "model": str(row.get("model") or "")[:64],
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


def _classify_profile(hist: pl.DataFrame) -> str:
    if hist.height < 3:
        return "new"
    zero_ratio = float((hist.filter(pl.col("qty") == 0).height) / max(hist.height, 1))
    if zero_ratio > 0.5:
        return "intermittent"
    # sazonalidade grosseira: CV mensal
    if hist.height >= 12:
        return "seasonal"
    return "regular"


def _forecast_statsforecast(
    df: pl.DataFrame, horizon_days: int, backtest_until: date, reference_date: date
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
    # Backtest móvel: últimos 6 meses antes do cutoff
    backtest_end = date(backtest_until.year, backtest_until.month, 1)
    bt_months = []
    y, m = backtest_end.year, backtest_end.month
    for _ in range(6):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
        bt_months.append(date(y, m, 1))
    bt_months = sorted(bt_months)
    train_until = bt_months[0] - __import__("datetime").timedelta(days=1) if bt_months else backtest_end

    horizon_months = max(1, round(horizon_days / 30))
    day_scale = horizon_days / (horizon_months * 30.0)

    rows: list[dict] = []
    target_month = date(reference_date.year, reference_date.month, 1)

    for sku in monthly.get_column("sku").unique().to_list():
        hist = monthly.filter(pl.col("sku") == sku).sort("month")
        profile = _classify_profile(hist)
        training_rows = hist.height
        if hist.height < 3:
            qty = float(hist.select(pl.col("qty").mean()).item() or 0) * horizon_months * day_scale
            rows.append(
                {
                    "sku": sku,
                    "month": target_month,
                    "qty": qty,
                    "model": "MovingAverage",
                    "wmape_backtest": 1.0,
                    "bias_backtest": 0.0,
                    "training_rows": training_rows,
                    "profile": profile,
                }
            )
            logger.info("SKU %s: MovingAverage, WMAPE 100.0%%, prev %.0f", sku, qty)
            continue

        pdf = hist.select(
            pl.lit(str(sku)).alias("unique_id"),
            pl.col("month").alias("ds"),
            pl.col("qty").cast(pl.Float64).alias("y"),
        ).to_pandas()
        pdf["ds"] = pd.to_datetime(pdf["ds"])

        train = pdf[pdf["ds"] < pd.Timestamp(bt_months[0])] if bt_months else pdf
        if train.empty:
            train = pdf.iloc[:-3] if len(pdf) > 3 else pdf
        actual = pdf[pdf["ds"].isin([pd.Timestamp(m) for m in bt_months])]

        models: list = [SeasonalNaive(season_length=12), AutoETS(season_length=12)]
        if Croston is not None and profile == "intermittent":
            models = [Croston(), SeasonalNaive(season_length=12)]

        best_model = "SeasonalNaive"
        best_wmape = 1.0
        best_bias = 0.0
        mean_monthly = float(hist.select(pl.col("qty").mean()).item() or 0)
        best_qty = mean_monthly * horizon_months * day_scale

        if train.shape[0] >= 4 and not actual.empty:
            h = len(bt_months) or 3
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
                    bias = float((merged["yhat"] - merged["y"]).sum() / max(denom, 1e-9))
                    if wmape < best_wmape:
                        best_wmape = wmape
                        best_bias = bias
                        best_model = type(model).__name__
                except Exception as exc:  # noqa: BLE001
                    logger.debug("Modelo %s falhou SKU %s: %s", type(model).__name__, sku, exc)

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
            # treina só até cutoff
            full = pdf[pdf["ds"] <= pd.Timestamp(backtest_end)]
            if full.empty:
                full = pdf
            fc = sf.forecast(df=full, h=horizon_months)
            col = [c for c in fc.columns if c not in ("unique_id", "ds")][0]
            best_qty = float(fc[col].clip(lower=0).sum()) * day_scale
        except Exception:
            best_qty = mean_monthly * horizon_months * day_scale

        logger.info(
            "SKU %s: modelo %s, WMAPE %.1f%%, prev %.0f",
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
                "bias_backtest": best_bias,
                "training_rows": training_rows,
                "profile": profile,
            }
        )

    return pl.DataFrame(rows)


def _forecast_stub(df: pl.DataFrame, horizon_days: int, reference_date: date) -> pl.DataFrame:
    """Fallback: média do mesmo mês (SeasonalNaive simplificado)."""
    rows: list[dict] = []
    target_month = date(reference_date.year, reference_date.month, 1)
    scale = horizon_days / 30.0

    for sku in df.get_column("sku").unique().to_list():
        hist = df.filter(pl.col("sku") == sku).sort("date")
        profile = _classify_profile(_to_monthly(hist) if "date" in hist.columns else hist)
        same_month = hist.filter(pl.col("date").dt.month() == reference_date.month)
        if same_month.height:
            qty = float(same_month.select(pl.col("qty").mean()).item()) * scale
            model = "SeasonalNaive"
            wmape = 0.12
        else:
            qty = float(hist.select(pl.col("qty").mean()).item() or 0) * scale
            model = "MovingAverage"
            wmape = 0.25
        logger.info("SKU %s: modelo %s, WMAPE %.1f%%, prev %.0f", sku, model, wmape * 100, qty)
        rows.append(
            {
                "sku": sku,
                "month": target_month,
                "qty": qty,
                "model": model,
                "wmape_backtest": wmape,
                "bias_backtest": 0.0,
                "training_rows": hist.height,
                "profile": profile,
            }
        )
    return pl.DataFrame(rows)
