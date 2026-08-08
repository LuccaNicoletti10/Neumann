"""Schemas Pandera (Polars) — validação contínua antes da ontologia."""

from __future__ import annotations

import pandera.polars as pa
import polars as pl
from pandera.engines.polars_engine import Date, DateTime


class ProductSchema(pa.DataFrameModel):
    sku: str = pa.Field(nullable=False, unique=True)
    description: str = pa.Field(nullable=True)
    family: str = pa.Field(nullable=True)
    unit: str = pa.Field(isin=["kg", "m", "unit", "un", "pc"])
    min_stock: float = pa.Field(nullable=True, ge=0)
    max_stock: float = pa.Field(nullable=True, ge=0)
    min_lot: float = pa.Field(nullable=True, ge=0)
    lot_multiple: float = pa.Field(nullable=True, gt=0)
    lead_time_days: int = pa.Field(nullable=True, ge=0)
    cost: float = pa.Field(nullable=True, ge=0)
    active: bool = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class SalesSchema(pa.DataFrameModel):
    id: str = pa.Field(nullable=False, unique=True)
    sku: str = pa.Field(nullable=False)
    date: Date = pa.Field(nullable=False)
    qty: float = pa.Field(nullable=False, ge=0)
    type: str = pa.Field(nullable=True, isin=["sale", "open_order", "forecast", "return", "cancel"])
    customer: str = pa.Field(nullable=True)
    price: float = pa.Field(nullable=True, ge=0)

    class Config:
        coerce = True
        strict = False


class InventorySchema(pa.DataFrameModel):
    sku: str = pa.Field(nullable=False)
    snapshot_date: Date = pa.Field(nullable=False)
    available: float = pa.Field(nullable=False, ge=0)
    blocked: float = pa.Field(nullable=True, ge=0)
    in_qc: float = pa.Field(nullable=True, ge=0)
    reserved: float = pa.Field(nullable=True, ge=0)
    in_process: float = pa.Field(nullable=True, ge=0)
    location: str = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class OpenOrdersSchema(pa.DataFrameModel):
    id: str = pa.Field(nullable=False, unique=True)
    sku: str = pa.Field(nullable=False)
    qty: float = pa.Field(nullable=False, ge=0)
    date: Date = pa.Field(nullable=True)
    customer: str = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class ProductionOrdersSchema(pa.DataFrameModel):
    id: str = pa.Field(nullable=False, unique=True)
    sku: str = pa.Field(nullable=False)
    machine_id: str = pa.Field(nullable=True)
    qty_planned: float = pa.Field(nullable=False, ge=0)
    qty_produced: float = pa.Field(nullable=True, ge=0)
    status: str = pa.Field(nullable=True)
    start_planned: DateTime = pa.Field(nullable=True)
    end_planned: DateTime = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class MachineSchema(pa.DataFrameModel):
    id: str = pa.Field(nullable=False, unique=True)
    work_center_id: str = pa.Field(nullable=False)
    name: str = pa.Field(nullable=True)
    hours_per_day: float = pa.Field(nullable=False, gt=0)
    shifts: int = pa.Field(nullable=False, ge=1)
    efficiency: float = pa.Field(nullable=False, ge=0, le=1)

    class Config:
        coerce = True
        strict = False


class WorkCenterSchema(pa.DataFrameModel):
    id: str = pa.Field(nullable=False, unique=True)
    name: str = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class BomSchema(pa.DataFrameModel):
    parent_sku: str = pa.Field(nullable=False)
    component_sku: str = pa.Field(nullable=False)
    qty_per_unit: float = pa.Field(nullable=False, gt=0)

    class Config:
        coerce = True
        strict = False


class RoutingSchema(pa.DataFrameModel):
    sku: str = pa.Field(nullable=False)
    step: int = pa.Field(nullable=False, ge=1)
    work_center_id: str = pa.Field(nullable=False)
    minutes_per_unit: float = pa.Field(nullable=False, gt=0)

    class Config:
        coerce = True
        strict = False


class CompatibilitySchema(pa.DataFrameModel):
    sku: str = pa.Field(nullable=False)
    machine_id: str = pa.Field(nullable=False)
    speed_units_per_hour: float = pa.Field(nullable=False, gt=0)

    class Config:
        coerce = True
        strict = False


class SetupMatrixSchema(pa.DataFrameModel):
    machine_id: str = pa.Field(nullable=False)
    from_family: str = pa.Field(nullable=False)
    to_family: str = pa.Field(nullable=False)
    setup_minutes: float = pa.Field(nullable=False, ge=0)
    forbidden: bool = pa.Field(nullable=False)

    class Config:
        coerce = True
        strict = False


class MachineCalendarSchema(pa.DataFrameModel):
    machine_id: str = pa.Field(nullable=False)
    date: Date = pa.Field(nullable=False)
    available_hours: float = pa.Field(nullable=False, ge=0)

    class Config:
        coerce = True
        strict = False


class MaintenanceSchema(pa.DataFrameModel):
    machine_id: str = pa.Field(nullable=False)
    start: DateTime = pa.Field(nullable=False)
    end: DateTime = pa.Field(nullable=False)
    hours: float = pa.Field(nullable=True, ge=0)

    class Config:
        coerce = True
        strict = False


class QualityEventsSchema(pa.DataFrameModel):
    id: str = pa.Field(nullable=False, unique=True)
    sku: str = pa.Field(nullable=True)
    machine_id: str = pa.Field(nullable=True)
    event_type: str = pa.Field(nullable=False)
    date: Date = pa.Field(nullable=False)
    blocks_production: bool = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


SCHEMA_BY_OUTPUT: dict[str, type[pa.DataFrameModel]] = {
    "clean.products": ProductSchema,
    "clean.sales": SalesSchema,
    "clean.inventory": InventorySchema,
    "clean.open_orders": OpenOrdersSchema,
    "clean.production_orders": ProductionOrdersSchema,
    "clean.machines": MachineSchema,
    "clean.work_centers": WorkCenterSchema,
    "clean.bom": BomSchema,
    "clean.routings": RoutingSchema,
    "clean.compatibility": CompatibilitySchema,
    "clean.setup_matrix": SetupMatrixSchema,
    "clean.machine_calendar": MachineCalendarSchema,
    "clean.maintenance": MaintenanceSchema,
    "clean.quality_events": QualityEventsSchema,
}


def validate_dataframe(df: pl.DataFrame, schema: type[pa.DataFrameModel]) -> pl.DataFrame:
    """Valida e retorna o DataFrame; falha = pipeline PARA."""
    return schema.validate(df, lazy=True)
