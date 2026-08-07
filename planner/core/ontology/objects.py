"""Objetos tipados da ontologia industrial (nomes universais em inglês)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any


@dataclass
class Product:
    sku: str
    description: str | None = None
    family: str | None = None
    unit: str | None = None
    min_stock: float | None = None
    max_stock: float | None = None
    min_lot: float | None = None
    lot_multiple: float | None = None
    lead_time_days: int | None = None
    cost: float | None = None
    active: bool | None = True
    props: dict[str, Any] = field(default_factory=dict)
    source_ref: str | None = None


@dataclass
class Machine:
    id: str
    work_center_id: str | None = None
    name: str | None = None
    hours_per_day: float | None = None
    shifts: int | None = None
    efficiency: float | None = None
    props: dict[str, Any] = field(default_factory=dict)


@dataclass
class InventoryPosition:
    sku: str
    snapshot_date: date
    available: float = 0.0
    blocked: float = 0.0
    in_qc: float = 0.0
    reserved: float = 0.0
    in_process: float = 0.0
    location: str | None = None
    props: dict[str, Any] = field(default_factory=dict)


@dataclass
class Demand:
    id: str
    sku: str
    date: date | None = None
    qty: float = 0.0
    type: str = "sale"
    customer: str | None = None
    price: float | None = None
    source_ref: str | None = None
    props: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProductionOrder:
    id: str
    sku: str
    machine_id: str | None = None
    qty_planned: float = 0.0
    qty_produced: float = 0.0
    start_planned: datetime | None = None
    end_planned: datetime | None = None
    start_actual: datetime | None = None
    end_actual: datetime | None = None
    status: str = "planned"
    scrap: float = 0.0
    rework: float = 0.0
    source_ref: str | None = None
    props: dict[str, Any] = field(default_factory=dict)


OBJECT_TYPES = {
    "Product": Product,
    "Machine": Machine,
    "InventoryPosition": InventoryPosition,
    "Demand": Demand,
    "ProductionOrder": ProductionOrder,
}
