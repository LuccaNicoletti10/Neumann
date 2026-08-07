"""Modelos SQLAlchemy 2.0 das tabelas concretas em schema `ontology`.

Separado de `models.py` (definições imutáveis da ontologia dinâmica).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base Declarative para tabelas de persistência da ontologia."""


class ProductModel(Base):
    """Produto / SKU — entidade central do planejamento."""

    __tablename__ = "product"
    __table_args__ = {"schema": "ontology"}

    sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    family: Mapped[str | None] = mapped_column(String(64), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    min_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_lot: Mapped[float | None] = mapped_column(Float, nullable=True)
    lot_multiple: Mapped[float | None] = mapped_column(Float, nullable=True)
    lead_time_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    props: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MachineModel(Base):
    __tablename__ = "machine"
    __table_args__ = {"schema": "ontology"}

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    work_center_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    hours_per_day: Mapped[float | None] = mapped_column(Float, nullable=True)
    shifts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    efficiency: Mapped[float | None] = mapped_column(Float, nullable=True)
    props: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)


class InventoryPositionModel(Base):
    __tablename__ = "inventory_position"
    __table_args__ = {"schema": "ontology"}

    sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    snapshot_date: Mapped[date] = mapped_column(Date, primary_key=True)
    available: Mapped[float | None] = mapped_column(Float, nullable=True)
    blocked: Mapped[float | None] = mapped_column(Float, nullable=True)
    in_qc: Mapped[float | None] = mapped_column(Float, nullable=True)
    reserved: Mapped[float | None] = mapped_column(Float, nullable=True)
    in_process: Mapped[float | None] = mapped_column(Float, nullable=True)
    location: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)


class DemandModel(Base):
    __tablename__ = "demand"
    __table_args__ = {"schema": "ontology"}

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    date: Mapped[date | None] = mapped_column(Date, nullable=True)
    qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    customer: Mapped[str | None] = mapped_column(String(128), nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)


class ProductionOrderModel(Base):
    __tablename__ = "production_order"
    __table_args__ = {"schema": "ontology"}

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    machine_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    qty_planned: Mapped[float | None] = mapped_column(Float, nullable=True)
    qty_produced: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_planned: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_planned: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    start_actual: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_actual: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    scrap: Mapped[float | None] = mapped_column(Float, nullable=True)
    rework: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)


class BomModel(Base):
    __tablename__ = "bom"
    __table_args__ = {"schema": "ontology"}

    parent_sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    component_sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    qty_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)


class RoutingModel(Base):
    __tablename__ = "routing"
    __table_args__ = {"schema": "ontology"}

    sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    step: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_center_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    minutes_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)


class CompatibilityModel(Base):
    __tablename__ = "compatibility"
    __table_args__ = {"schema": "ontology"}

    sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    machine_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    speed_units_per_hour: Mapped[float | None] = mapped_column(Float, nullable=True)


class SetupMatrixModel(Base):
    __tablename__ = "setup_matrix"
    __table_args__ = {"schema": "ontology"}

    machine_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    from_family: Mapped[str] = mapped_column(String(64), primary_key=True)
    to_family: Mapped[str] = mapped_column(String(64), primary_key=True)
    setup_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    forbidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
