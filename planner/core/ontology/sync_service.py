"""Sync Service — único funil de escrita na camada ontology (in-memory + contrato)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import polars as pl

from .objects import InventoryPosition, Product

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    inserted: int = 0
    updated: int = 0
    ignored: int = 0
    errors: list[str] = field(default_factory=list)


class SyncService:
    """
    Orquestra escritas na ontologia.

    Implementação MVP: store in-memory. Em produção, SQLAlchemy 2.0 + Postgres.
    """

    def __init__(self) -> None:
        self.products: dict[str, Product] = {}
        self.inventory: list[InventoryPosition] = []
        self.demand: dict[str, Any] = {}

    def sync_products(self, client: str, df: pl.DataFrame, source_ref: str) -> SyncResult:
        result = SyncResult()
        for row in df.to_dicts():
            sku = str(row.get("sku", "")).strip()
            if not sku:
                result.errors.append("sku ausente")
                continue
            payload = Product(
                sku=sku,
                description=row.get("description"),
                family=row.get("family"),
                unit=row.get("unit"),
                min_stock=_f(row.get("min_stock")),
                max_stock=_f(row.get("max_stock")),
                min_lot=_f(row.get("min_lot")),
                lot_multiple=_f(row.get("lot_multiple")),
                lead_time_days=_i(row.get("lead_time_days")),
                cost=_f(row.get("cost")),
                active=bool(row.get("active", True)),
                source_ref=source_ref,
            )
            existing = self.products.get(sku)
            if existing is None:
                self.products[sku] = payload
                result.inserted += 1
            elif existing != payload:
                self.products[sku] = payload
                result.updated += 1
            else:
                result.ignored += 1
        logger.info(
            "sync_products client=%s inserted=%s updated=%s ignored=%s",
            client,
            result.inserted,
            result.updated,
            result.ignored,
        )
        return result

    def sync_inventory(
        self, client: str, df: pl.DataFrame, snapshot_date: date, source_ref: str
    ) -> SyncResult:
        result = SyncResult()
        for row in df.to_dicts():
            self.inventory.append(
                InventoryPosition(
                    sku=str(row["sku"]),
                    snapshot_date=snapshot_date,
                    available=float(row.get("available") or row.get("quantity") or 0),
                    blocked=float(row.get("blocked") or 0),
                    in_qc=float(row.get("in_qc") or 0),
                    reserved=float(row.get("reserved") or 0),
                    in_process=float(row.get("in_process") or 0),
                    location=row.get("location"),
                )
            )
            result.inserted += 1
        logger.info("sync_inventory client=%s rows=%s ref=%s", client, result.inserted, source_ref)
        return result

    def get_object(self, object_type: str, key: Any) -> Any | None:
        if object_type == "Product":
            return self.products.get(str(key))
        return None


def _f(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _i(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return int(value)
