"""Sync Service — único funil de escrita na camada ontology (PostgreSQL)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

import polars as pl
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from planner.core.db import get_session_factory

from .db_models import DemandModel, InventoryPositionModel, ProductModel
from .objects import Demand, InventoryPosition, Product

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    """Contagem de linhas afetadas por uma sincronização."""

    inserted: int = 0
    updated: int = 0
    ignored: int = 0
    errors: list[str] = field(default_factory=list)


class SyncService:
    """
    Orquestra escritas na ontologia via SQLAlchemy 2.0 + PostgreSQL.

    Upsert em produtos/demanda; inventário grava snapshot do dia (insert;
    re-sync do mesmo dia atualiza a linha PK).
    Nunca apaga linhas — use active=false quando precisar desativar produto.
    """

    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        self._session_factory = session_factory or get_session_factory()

    def sync_products(self, client: str, df: pl.DataFrame, source_ref: str) -> SyncResult:
        """Upsert de produtos em ontology.product."""
        result = SyncResult()
        if df.is_empty():
            return result

        session = self._session_factory()
        try:
            skus = [
                str(row.get("sku", "")).strip()
                for row in df.to_dicts()
                if str(row.get("sku", "")).strip()
            ]
            existing_map = self._load_products(session, skus)

            for row in df.to_dicts():
                sku = str(row.get("sku", "")).strip()
                if not sku:
                    result.errors.append("sku ausente")
                    continue

                props = row.get("props") if isinstance(row.get("props"), dict) else {}
                values = {
                    "sku": sku,
                    "description": _str(row.get("description")),
                    "family": _str(row.get("family")),
                    "unit": _str(row.get("unit")),
                    "min_stock": _f(row.get("min_stock")),
                    "max_stock": _f(row.get("max_stock")),
                    "min_lot": _f(row.get("min_lot")),
                    "lot_multiple": _f(row.get("lot_multiple")),
                    "lead_time_days": _i(row.get("lead_time_days")),
                    "cost": _f(row.get("cost")),
                    "active": bool(row.get("active", True)),
                    "props": props or {},
                    "source_ref": source_ref,
                    "updated_at": datetime.now(timezone.utc),
                }

                existing = existing_map.get(sku)
                if existing is not None and _product_unchanged(existing, values):
                    result.ignored += 1
                    continue

                stmt = insert(ProductModel).values(**values, created_at=datetime.now(timezone.utc))
                update_cols = {
                    c: stmt.excluded[c]
                    for c in values
                    if c not in {"sku", "created_at"}
                }
                stmt = stmt.on_conflict_do_update(index_elements=["sku"], set_=update_cols)
                session.execute(stmt)

                if existing is None:
                    result.inserted += 1
                else:
                    result.updated += 1

            session.commit()
            logger.info(
                "sync_products client=%s inserted=%s updated=%s ignored=%s source_ref=%s",
                client,
                result.inserted,
                result.updated,
                result.ignored,
                source_ref,
            )
        except Exception as exc:
            session.rollback()
            logger.error("Falha ao sincronizar produtos client=%s: %s", client, exc)
            result.errors.append(str(exc))
        finally:
            session.close()
        return result

    def sync_inventory(
        self, client: str, df: pl.DataFrame, snapshot_date: date, source_ref: str
    ) -> SyncResult:
        """
        Grava snapshot de estoque em ontology.inventory_position.

        Cada chamada representa um snapshot do dia. Não atualiza snapshots
        de outras datas. Re-sync do mesmo (sku, snapshot_date) atualiza a linha.
        """
        result = SyncResult()
        if df.is_empty():
            return result

        session = self._session_factory()
        try:
            for row in df.to_dicts():
                sku = str(row.get("sku", "")).strip()
                if not sku:
                    result.errors.append("sku ausente no inventário")
                    continue
                values = {
                    "sku": sku,
                    "snapshot_date": snapshot_date,
                    "available": float(row.get("available") or row.get("quantity") or 0),
                    "blocked": float(row.get("blocked") or 0),
                    "in_qc": float(row.get("in_qc") or 0),
                    "reserved": float(row.get("reserved") or 0),
                    "in_process": float(row.get("in_process") or 0),
                    "location": _str(row.get("location")),
                    "source_ref": source_ref,
                }
                exists = session.execute(
                    select(InventoryPositionModel).where(
                        InventoryPositionModel.sku == sku,
                        InventoryPositionModel.snapshot_date == snapshot_date,
                    )
                ).scalar_one_or_none()

                stmt = insert(InventoryPositionModel).values(**values)
                if exists is None:
                    session.execute(stmt)
                    result.inserted += 1
                else:
                    # mesmo dia: atualiza valores sem apagar histórico de outros dias
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["sku", "snapshot_date"],
                        set_={
                            "available": stmt.excluded.available,
                            "blocked": stmt.excluded.blocked,
                            "in_qc": stmt.excluded.in_qc,
                            "reserved": stmt.excluded.reserved,
                            "in_process": stmt.excluded.in_process,
                            "location": stmt.excluded.location,
                            "source_ref": stmt.excluded.source_ref,
                        },
                    )
                    session.execute(stmt)
                    result.updated += 1

            session.commit()
            logger.info(
                "sync_inventory client=%s inserted=%s updated=%s ignored=%s source_ref=%s",
                client,
                result.inserted,
                result.updated,
                result.ignored,
                source_ref,
            )
        except Exception as exc:
            session.rollback()
            logger.error("Falha ao sincronizar inventário client=%s: %s", client, exc)
            result.errors.append(str(exc))
        finally:
            session.close()
        return result

    def sync_demand(self, client: str, df: pl.DataFrame, source_ref: str) -> SyncResult:
        """Upsert de demanda (venda / pedido / forecast) em ontology.demand."""
        result = SyncResult()
        if df.is_empty():
            return result

        session = self._session_factory()
        try:
            ids = [str(row.get("id", "")).strip() for row in df.to_dicts() if row.get("id")]
            existing_ids = set()
            if ids:
                existing_ids = set(
                    session.execute(
                        select(DemandModel.id).where(DemandModel.id.in_(ids))
                    ).scalars()
                )

            for row in df.to_dicts():
                demand_id = str(row.get("id", "")).strip()
                sku = str(row.get("sku", "")).strip()
                if not demand_id or not sku:
                    result.errors.append("id/sku ausente na demanda")
                    continue

                demand_date = row.get("date")
                if isinstance(demand_date, str) and demand_date:
                    demand_date = date.fromisoformat(demand_date[:10])
                elif not isinstance(demand_date, date):
                    demand_date = None

                values = {
                    "id": demand_id,
                    "sku": sku,
                    "date": demand_date,
                    "qty": _f(row.get("qty")) or 0.0,
                    "type": _str(row.get("type")) or "sale",
                    "customer": _str(row.get("customer")),
                    "price": _f(row.get("price")),
                    "source_ref": source_ref,
                }
                stmt = insert(DemandModel).values(**values)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["id"],
                    set_={
                        "sku": stmt.excluded.sku,
                        "date": stmt.excluded.date,
                        "qty": stmt.excluded.qty,
                        "type": stmt.excluded.type,
                        "customer": stmt.excluded.customer,
                        "price": stmt.excluded.price,
                        "source_ref": stmt.excluded.source_ref,
                    },
                )
                session.execute(stmt)
                if demand_id in existing_ids:
                    result.updated += 1
                else:
                    result.inserted += 1

            session.commit()
            logger.info(
                "sync_demand client=%s inserted=%s updated=%s ignored=%s source_ref=%s",
                client,
                result.inserted,
                result.updated,
                result.ignored,
                source_ref,
            )
        except Exception as exc:
            session.rollback()
            logger.error("Falha ao sincronizar demanda client=%s: %s", client, exc)
            result.errors.append(str(exc))
        finally:
            session.close()
        return result

    def get_object(self, object_type: str, key: Any) -> Any | None:
        """SELECT no Postgres — retorna dataclass de domínio ou None."""
        session = self._session_factory()
        try:
            if object_type == "Product":
                row = session.execute(
                    select(ProductModel).where(ProductModel.sku == str(key))
                ).scalar_one_or_none()
                return _to_product(row) if row else None
            if object_type == "InventoryPosition":
                # key = (sku, snapshot_date) ou "sku|YYYY-MM-DD"
                sku, snap = _parse_inventory_key(key)
                if snap is None:
                    return None
                row = session.execute(
                    select(InventoryPositionModel).where(
                        InventoryPositionModel.sku == sku,
                        InventoryPositionModel.snapshot_date == snap,
                    )
                ).scalar_one_or_none()
                return _to_inventory(row) if row else None
            if object_type == "Demand":
                row = session.execute(
                    select(DemandModel).where(DemandModel.id == str(key))
                ).scalar_one_or_none()
                return _to_demand(row) if row else None
            return None
        except Exception as exc:
            logger.error("Falha em get_object type=%s key=%s: %s", object_type, key, exc)
            return None
        finally:
            session.close()

    def _load_products(self, session: Session, skus: list[str]) -> dict[str, ProductModel]:
        if not skus:
            return {}
        rows = session.execute(
            select(ProductModel).where(ProductModel.sku.in_(skus))
        ).scalars()
        return {r.sku: r for r in rows}


def _product_unchanged(existing: ProductModel, values: dict[str, Any]) -> bool:
    # source_ref muda a cada run — não conta como alteração de negócio
    fields = (
        "description",
        "family",
        "unit",
        "min_stock",
        "max_stock",
        "min_lot",
        "lot_multiple",
        "lead_time_days",
        "cost",
        "active",
    )
    for name in fields:
        if getattr(existing, name) != values.get(name):
            return False
    existing_props = existing.props or {}
    new_props = values.get("props") or {}
    return existing_props == new_props


def _to_product(row: ProductModel) -> Product:
    return Product(
        sku=row.sku,
        description=row.description,
        family=row.family,
        unit=row.unit,
        min_stock=row.min_stock,
        max_stock=row.max_stock,
        min_lot=row.min_lot,
        lot_multiple=row.lot_multiple,
        lead_time_days=row.lead_time_days,
        cost=row.cost,
        active=row.active,
        props=dict(row.props or {}),
        source_ref=row.source_ref,
    )


def _to_inventory(row: InventoryPositionModel) -> InventoryPosition:
    return InventoryPosition(
        sku=row.sku,
        snapshot_date=row.snapshot_date,
        available=row.available or 0.0,
        blocked=row.blocked or 0.0,
        in_qc=row.in_qc or 0.0,
        reserved=row.reserved or 0.0,
        in_process=row.in_process or 0.0,
        location=row.location,
    )


def _to_demand(row: DemandModel) -> Demand:
    return Demand(
        id=row.id,
        sku=row.sku,
        date=row.date,
        qty=row.qty or 0.0,
        type=row.type or "sale",
        customer=row.customer,
        price=row.price,
        source_ref=row.source_ref,
    )


def _parse_inventory_key(key: Any) -> tuple[str, date | None]:
    if isinstance(key, (tuple, list)) and len(key) == 2:
        snap = key[1]
        if isinstance(snap, str):
            snap = date.fromisoformat(snap)
        return str(key[0]), snap
    if isinstance(key, str) and "|" in key:
        sku, snap_s = key.split("|", 1)
        return sku, date.fromisoformat(snap_s)
    return str(key), None


def _f(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _i(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
