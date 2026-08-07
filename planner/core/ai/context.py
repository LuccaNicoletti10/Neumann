"""Context Service — monta pacote de contexto para o LLM a partir do Postgres."""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from planner.core.db import get_session_factory
from planner.core.ontology.db_models import (
    BomModel,
    CompatibilityModel,
    DemandModel,
    InventoryPositionModel,
    ProductModel,
    ProductionOrderModel,
    SetupMatrixModel,
)

logger = logging.getLogger(__name__)

# ~4 chars/token → 2000 tokens ≈ 8000 chars
_MAX_CHARS = 8000


class ContextService:
    """
    Monta contexto Markdown para o narrador.

    Lê do Postgres (ontologia). Cache TTL em memória.
    """

    def __init__(
        self,
        session_factory: sessionmaker[Session] | None = None,
        ttl_seconds: int = 300,
        store: dict[str, Any] | None = None,
    ) -> None:
        self._session_factory = session_factory or get_session_factory()
        self.ttl_seconds = ttl_seconds
        # legado: store dict ainda aceito como override de teste
        self.store = store or {}
        self._cache: dict[tuple[str, str], tuple[float, str]] = {}

    def build_context(self, object_type: str, key: Any, depth: int = 2) -> str:
        """API legada — encaminha para build_product_context quando Product."""
        if object_type.lower() in {"product", "sku"}:
            return self.build_product_context(str(key), client=str(self.store.get("client", "")))
        return self.build_product_context(str(key), client="")

    def build_product_context(self, sku: str, client: str = "") -> str:
        """
        Contexto completo do SKU para o LLM (máx. ~2000 tokens).

        Inclui produto, estoque, demanda 12m, OPs, BOM, compatibility, setup.
        """
        cache_key = ("Product", f"{client}:{sku}")
        now = time.time()
        hit = self._cache.get(cache_key)
        if hit and now - hit[0] < self.ttl_seconds:
            return hit[1]

        # override de teste via store
        if self.store.get("products") and sku in self.store["products"]:
            text = self._from_store(sku)
            self._cache[cache_key] = (now, text)
            return text

        session = self._session_factory()
        try:
            text = self._build_from_db(session, sku)
        except Exception as exc:
            logger.error("Falha ao montar contexto sku=%s: %s", sku, exc)
            text = f"=== PRODUCT: {sku} ===\n(contexto indisponível: {exc})"
        finally:
            session.close()

        if len(text) > _MAX_CHARS:
            text = text[: _MAX_CHARS - 20] + "\n...[truncado]"
        self._cache[cache_key] = (now, text)
        return text

    def _build_from_db(self, session: Session, sku: str) -> str:
        product = session.execute(
            select(ProductModel).where(ProductModel.sku == sku)
        ).scalar_one_or_none()

        inv = session.execute(
            select(InventoryPositionModel)
            .where(InventoryPositionModel.sku == sku)
            .order_by(InventoryPositionModel.snapshot_date.desc())
            .limit(1)
        ).scalar_one_or_none()

        since = date.today() - timedelta(days=365)
        demand_rows = session.execute(
            select(
                func.date_trunc("month", DemandModel.date).label("month"),
                func.sum(DemandModel.qty).label("qty"),
            )
            .where(DemandModel.sku == sku, DemandModel.date >= since)
            .group_by(func.date_trunc("month", DemandModel.date))
            .order_by(func.date_trunc("month", DemandModel.date))
        ).all()

        open_ops = session.execute(
            select(ProductionOrderModel).where(ProductionOrderModel.sku == sku)
        ).scalars().all()
        open_ops = [
            op
            for op in open_ops
            if (op.status or "planned") in {"planned", "released", "in_progress"}
        ]

        bom = session.execute(
            select(BomModel).where(BomModel.parent_sku == sku)
        ).scalars().all()

        compat = session.execute(
            select(CompatibilityModel).where(CompatibilityModel.sku == sku)
        ).scalars().all()

        family = product.family if product else None
        setups = []
        if family:
            setups = session.execute(
                select(SetupMatrixModel).where(
                    (SetupMatrixModel.from_family == family)
                    | (SetupMatrixModel.to_family == family)
                ).limit(20)
            ).scalars().all()

        lines = [
            f"=== PRODUCT: {sku} - {(product.description if product else '')} ===",
            f"Família: {(product.family if product else '-')}",
            f"Unidade: {(product.unit if product else '-')}",
            f"Estoque mín: {(product.min_stock if product else '-')} | "
            f"lote mín: {(product.min_lot if product else '-')}",
            f"Lead time: {(product.lead_time_days if product else '-')} dias | "
            f"ativo: {(product.active if product else '-')}",
            "--- ESTOQUE ATUAL ---",
            f"Disponível: {(inv.available if inv else 0)}",
            f"Bloqueado: {(inv.blocked if inv else 0)}",
            f"Em QC: {(inv.in_qc if inv else 0)}",
            f"Reservado: {(inv.reserved if inv else 0)}",
            f"Em processo: {(inv.in_process if inv else 0)}",
            f"Snapshot: {(inv.snapshot_date.isoformat() if inv and inv.snapshot_date else '-')}",
            "--- DEMANDA 12 MESES ---",
        ]
        if demand_rows:
            for row in demand_rows:
                month = row.month.date() if hasattr(row.month, "date") else row.month
                lines.append(f"  {month}: {float(row.qty or 0):.0f}")
        else:
            lines.append("  (sem demanda registrada)")

        lines.append("--- OPS ABERTAS ---")
        if open_ops:
            for op in open_ops[:10]:
                lines.append(
                    f"  {op.id}: planejado={op.qty_planned} produzido={op.qty_produced} "
                    f"status={op.status} máquina={op.machine_id}"
                )
        else:
            lines.append("  (nenhuma)")

        lines.append("--- BOM ---")
        if bom:
            for b in bom:
                lines.append(f"  {b.component_sku}: {b.qty_per_unit} por unidade")
        else:
            lines.append("  (sem BOM)")

        lines.append("--- COMPATIBILIDADE ---")
        if compat:
            for c in compat:
                lines.append(f"  {c.machine_id}: {c.speed_units_per_hour} un/h")
        else:
            lines.append("  (sem compatibility)")

        lines.append("--- SETUP (família) ---")
        if setups:
            for s in setups[:10]:
                lines.append(
                    f"  {s.machine_id}: {s.from_family}→{s.to_family} "
                    f"{s.setup_minutes}min forbidden={s.forbidden}"
                )
        else:
            lines.append("  (sem setup_matrix)")

        return "\n".join(lines)

    def _from_store(self, sku: str) -> str:
        product = self.store.get("products", {}).get(sku, {})
        inventory = self.store.get("inventory", {}).get(sku, {})
        return "\n".join(
            [
                f"=== PRODUCT: {sku} - {product.get('description', '')} ===",
                f"Família: {product.get('family', '-')}",
                f"Unidade: {product.get('unit', '-')}",
                f"Estoque mínimo: {product.get('min_stock', '-')} | "
                f"lote mínimo: {product.get('min_lot', '-')}",
                "--- ESTOQUE ATUAL ---",
                f"Disponível: {inventory.get('available', 0)}",
                f"Bloqueado: {inventory.get('blocked', 0)}",
                f"Em processo: {inventory.get('in_process', 0)}",
            ]
        )
