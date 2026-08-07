"""MRP / netting — necessidade líquida (função pura)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import polars as pl


@dataclass
class BOMShortage:
    component_sku: str
    required: float
    available: float


@dataclass
class NettingResult:
    sku: str
    net_requirement: float
    suggested_qty: float
    suggested_date: date
    reason: str
    bom_shortages: list[BOMShortage] = field(default_factory=list)


def safety_stock(demand_std: float, lead_time_days: float, z: float = 1.645) -> float:
    """z × σ × √lead_time."""
    if lead_time_days <= 0:
        return 0.0
    return z * demand_std * math.sqrt(lead_time_days)


def calculate_net_requirements(
    forecasts: pl.DataFrame,
    inventory: pl.DataFrame,
    open_orders: pl.DataFrame,
    open_production: pl.DataFrame,
    products: pl.DataFrame,
    bom: pl.DataFrame,
    policies: dict[str, Any],
    *,
    today: date | None = None,
) -> list[NettingResult]:
    """
    necessidade_liquida =
      previsão + carteira + estoque_segurança
      - disponível - OP abertas (planejado - produzido)
    """
    today = today or date.today()
    results: list[NettingResult] = []
    default_z = float(policies.get("service_level_z", 1.645))
    cover_days = int(policies.get("min_days_of_cover", 12))

    skus = products.get_column("sku").to_list() if "sku" in products.columns else []
    for sku in skus:
        prod = products.filter(pl.col("sku") == sku).to_dicts()[0]
        lead = float(prod.get("lead_time_days") or policies.get("default_lead_time_days", 10))
        min_lot = float(prod.get("min_lot") or 0)
        lot_multiple = float(prod.get("lot_multiple") or 1) or 1.0

        fc = forecasts.filter(pl.col("sku") == sku) if "sku" in forecasts.columns else forecasts.head(0)
        forecast_qty = float(fc.select(pl.col("qty").sum()).item()) if fc.height else 0.0

        inv = inventory.filter(pl.col("sku") == sku) if "sku" in inventory.columns else inventory.head(0)
        available = float(inv.select(pl.col("available").sum()).item()) if inv.height and "available" in inv.columns else 0.0

        oo = open_orders.filter(pl.col("sku") == sku) if open_orders.height and "sku" in open_orders.columns else open_orders.head(0)
        open_order_qty = float(oo.select(pl.col("qty").sum()).item()) if oo.height else 0.0

        op = open_production.filter(pl.col("sku") == sku) if open_production.height and "sku" in open_production.columns else open_production.head(0)
        if op.height and "qty_planned" in op.columns:
            open_prod = float(
                op.select((pl.col("qty_planned") - pl.col("qty_produced").fill_null(0)).sum()).item()
            )
        else:
            open_prod = 0.0

        daily = forecast_qty / max(cover_days, 1)
        days_of_cover = (available / daily) if daily > 0 else 999.0
        ss = safety_stock(daily, lead, default_z)

        net = forecast_qty + open_order_qty + ss - available - open_prod
        net = max(net, 0.0)

        if days_of_cover >= lead and net <= 0:
            results.append(
                NettingResult(
                    sku=sku,
                    net_requirement=0.0,
                    suggested_qty=0.0,
                    suggested_date=today,
                    reason=f"estoque cobre {days_of_cover:.0f} dias, lead time {lead:.0f} dias",
                )
            )
            continue

        suggested = net
        if suggested > 0 and suggested < min_lot:
            suggested = min_lot
        if lot_multiple > 0 and suggested > 0:
            suggested = math.ceil(suggested / lot_multiple) * lot_multiple

        shortages: list[BOMShortage] = []
        if bom.height and "parent_sku" in bom.columns:
            comps = bom.filter(pl.col("parent_sku") == sku)
            for comp in comps.to_dicts():
                need = suggested * float(comp.get("qty_per_unit") or 0)
                csku = str(comp["component_sku"])
                cinv = inventory.filter(pl.col("sku") == csku) if "sku" in inventory.columns else inventory.head(0)
                cavail = float(cinv.select(pl.col("available").sum()).item()) if cinv.height else 0.0
                if cavail < need:
                    shortages.append(BOMShortage(csku, need, cavail))

        results.append(
            NettingResult(
                sku=sku,
                net_requirement=net,
                suggested_qty=suggested,
                suggested_date=today + timedelta(days=max(int(lead) - int(days_of_cover), 0)),
                reason=f"estoque cobre {days_of_cover:.0f} dias, lead time {lead:.0f} dias",
                bom_shortages=shortages,
            )
        )
    return results
