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
    usable_stock: float = 0.0
    safety_stock: float = 0.0


def safety_stock(demand_std: float, lead_time_days: float, z: float = 1.645) -> float:
    """estoque_segurança = z × σ × √lead_time."""
    if lead_time_days <= 0 or demand_std <= 0:
        return 0.0
    return z * demand_std * math.sqrt(lead_time_days)


def usable_inventory(row: dict[str, Any]) -> float:
    """
    estoque utilizável =
      disponível - bloqueado - em qualidade - reservado
    (em processo NÃO entra no utilizável para atendimento imediato)
    """
    available = float(row.get("available") or 0)
    blocked = float(row.get("blocked") or 0)
    in_qc = float(row.get("in_qc") or 0)
    reserved = float(row.get("reserved") or 0)
    return max(available - blocked - in_qc - reserved, 0.0)


def demand_std_daily(sales_history: pl.DataFrame, sku: str, window_days: int = 90) -> float:
    """Desvio-padrão da demanda diária a partir do histórico real."""
    if sales_history.is_empty() or "sku" not in sales_history.columns:
        return 0.0
    hist = sales_history.filter(pl.col("sku") == sku)
    if hist.is_empty() or "qty" not in hist.columns:
        return 0.0
    if "date" in hist.columns:
        daily = (
            hist.with_columns(pl.col("date").cast(pl.Date))
            .group_by("date")
            .agg(pl.col("qty").sum().alias("qty"))
            .sort("date")
            .tail(window_days)
        )
    else:
        daily = hist.select(pl.col("qty"))
    if daily.height < 2:
        return float(daily.select(pl.col("qty").std()).item() or 0.0)
    return float(daily.select(pl.col("qty").std()).item() or 0.0)


def calculate_net_requirements(
    forecasts: pl.DataFrame,
    inventory: pl.DataFrame,
    open_orders: pl.DataFrame,
    open_production: pl.DataFrame,
    products: pl.DataFrame,
    bom: pl.DataFrame,
    policies: dict[str, Any],
    *,
    sales_history: pl.DataFrame | None = None,
    today: date | None = None,
    block_on_bom_shortage: bool = True,
) -> list[NettingResult]:
    """
    necessidade_liquida =
      previsão + carteira + estoque_segurança
      - estoque_utilizável - OP abertas (planejado - produzido)
    """
    today = today or date.today()
    sales_history = sales_history if sales_history is not None else pl.DataFrame({"sku": [], "date": [], "qty": []})
    results: list[NettingResult] = []
    default_z = float(policies.get("service_level_z", 1.645))
    cover_days = int(policies.get("min_days_of_cover", 12))
    max_lot = policies.get("max_lot")

    skus = products.get_column("sku").to_list() if "sku" in products.columns else []
    for sku in skus:
        prod = products.filter(pl.col("sku") == sku).to_dicts()[0]
        family = str(prod.get("family") or "DEFAULT")
        fam_pol = (policies.get("families") or {}).get(family) or {}
        z = float(fam_pol.get("service_level_z", default_z))
        lead = float(prod.get("lead_time_days") or fam_pol.get("lead_time_days") or policies.get("default_lead_time_days", 10))
        min_lot = float(prod.get("min_lot") or fam_pol.get("min_lot") or 0)
        lot_multiple = float(prod.get("lot_multiple") or fam_pol.get("lot_multiple") or 1) or 1.0
        yield_factor = float(fam_pol.get("yield", policies.get("yield", 1.0)) or 1.0)
        scrap = float(fam_pol.get("scrap_rate", policies.get("scrap_rate", 0.0)) or 0.0)

        fc = forecasts.filter(pl.col("sku") == sku) if "sku" in forecasts.columns else forecasts.head(0)
        forecast_qty = float(fc.select(pl.col("qty").sum()).item()) if fc.height else 0.0

        inv = inventory.filter(pl.col("sku") == sku) if "sku" in inventory.columns else inventory.head(0)
        usable = 0.0
        if inv.height:
            for row in inv.to_dicts():
                usable += usable_inventory(row)

        oo = open_orders.filter(pl.col("sku") == sku) if open_orders.height and "sku" in open_orders.columns else open_orders.head(0)
        open_order_qty = float(oo.select(pl.col("qty").sum()).item()) if oo.height else 0.0

        op = open_production.filter(pl.col("sku") == sku) if open_production.height and "sku" in open_production.columns else open_production.head(0)
        if op.height and "qty_planned" in op.columns:
            open_prod = float(
                op.select((pl.col("qty_planned") - pl.col("qty_produced").fill_null(0)).sum()).item()
            )
        else:
            open_prod = 0.0

        sigma = demand_std_daily(sales_history, sku)
        ss = safety_stock(sigma, lead, z)

        daily = forecast_qty / max(cover_days, 1)
        days_of_cover = (usable / daily) if daily > 0 else 999.0

        net = forecast_qty + open_order_qty + ss - usable - open_prod
        net = max(net, 0.0)
        # perdas / rendimento
        if yield_factor > 0 and yield_factor < 1:
            net = net / yield_factor
        if scrap > 0:
            net = net * (1.0 + scrap)

        if days_of_cover >= lead and net <= 0:
            results.append(
                NettingResult(
                    sku=sku,
                    net_requirement=0.0,
                    suggested_qty=0.0,
                    suggested_date=today,
                    reason=f"estoque utilizável cobre {days_of_cover:.0f} dias, lead time {lead:.0f} dias",
                    usable_stock=usable,
                    safety_stock=ss,
                )
            )
            continue

        suggested = net
        if suggested > 0 and suggested < min_lot:
            suggested = min_lot
        if lot_multiple > 0 and suggested > 0:
            suggested = math.ceil(suggested / lot_multiple) * lot_multiple
        if max_lot is not None and suggested > float(max_lot):
            suggested = float(max_lot)

        shortages: list[BOMShortage] = []
        if bom.height and "parent_sku" in bom.columns:
            comps = bom.filter(pl.col("parent_sku") == sku)
            for comp in comps.to_dicts():
                need = suggested * float(comp.get("qty_per_unit") or 0)
                csku = str(comp["component_sku"])
                cinv = inventory.filter(pl.col("sku") == csku) if "sku" in inventory.columns else inventory.head(0)
                cavail = 0.0
                for row in cinv.to_dicts():
                    cavail += usable_inventory(row)
                if cavail < need:
                    shortages.append(BOMShortage(csku, need, cavail))

        if block_on_bom_shortage and shortages and policies.get("block_on_bom_shortage", True):
            suggested = 0.0
            reason = f"BOM bloqueada: faltam {[s.component_sku for s in shortages]}"
        else:
            reason = f"estoque utilizável cobre {days_of_cover:.0f} dias, lead time {lead:.0f} dias"

        results.append(
            NettingResult(
                sku=sku,
                net_requirement=net,
                suggested_qty=suggested,
                suggested_date=today + timedelta(days=max(int(lead) - int(days_of_cover), 0)),
                reason=reason,
                bom_shortages=shortages,
                usable_stock=usable,
                safety_stock=ss,
            )
        )
    return results
