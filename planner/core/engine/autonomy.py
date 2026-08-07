"""Autonomia limitada — privilégio conquistado por métrica (Postgres)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from planner.core.db import get_session_factory
from planner.core.engine.decision_log import DecisionLogService
from planner.core.engine.models import AutonomyLogModel
from planner.core.ontology.db_models import ProductModel
from sqlalchemy import select

logger = logging.getLogger(__name__)


@dataclass
class FamilyAutonomyStatus:
    family: str
    eligible: bool
    approval_rate: float
    reason: str


class AutonomyService:
    """
    Autonomia é privilégio por métrica, não toggle.

    Consulta DecisionLogService no Postgres e audita em audit.autonomy_log.
    """

    def __init__(
        self,
        approval_threshold: float = 0.85,
        session_factory: sessionmaker[Session] | None = None,
        decision_log: DecisionLogService | None = None,
        weeks: int = 4,
    ) -> None:
        self.approval_threshold = approval_threshold
        self.weeks = weeks
        self._session_factory = session_factory or get_session_factory()
        self._decision_log = decision_log or DecisionLogService(
            session_factory=self._session_factory
        )

    def evaluate_family_eligibility(
        self, family: str, client: str
    ) -> FamilyAutonomyStatus:
        """Eligibilidade da família com base em approval_rate das últimas N semanas."""
        metrics = self._decision_log.get_learning_metrics(
            client=client, family=family, weeks=self.weeks
        )
        ok = (
            metrics.total_lines > 0
            and metrics.approval_rate > self.approval_threshold
        )
        reason = (
            ""
            if ok
            else (
                f"taxa de aprovação {metrics.approval_rate:.0%} insuficiente "
                f"(limite {self.approval_threshold:.0%}, n={metrics.total_lines})"
            )
        )
        status = FamilyAutonomyStatus(
            family=family,
            eligible=ok,
            approval_rate=metrics.approval_rate,
            reason=reason,
        )
        self._audit(
            client=client,
            family=family,
            plan_line_id=None,
            allowed=ok,
            approval_rate=metrics.approval_rate,
            reason=reason or "família elegível para autonomia",
        )
        return status

    def can_run_autonomous(
        self,
        plan_line: dict[str, Any],
        client: str,
        *,
        capacity_ok: bool = True,
        material_ok: bool = True,
        financial_ok: bool = True,
        no_quality_exceptions: bool = True,
    ) -> tuple[bool, str]:
        """
        Avalia se uma linha do plano pode rodar sem aprovação humana.

        Busca produto no Postgres e métricas reais do decision_log.
        """
        sku = str(plan_line.get("sku", ""))
        family = str(plan_line.get("family") or "")
        plan_line_id = str(plan_line.get("plan_line_id") or plan_line.get("id") or "")

        product = self._load_product(sku)
        is_make_to_stock = bool(product.get("active", True)) and not bool(
            product.get("props", {}).get("make_to_order", False)
        )
        data_complete = bool(sku) and bool(product.get("sku"))

        if not family:
            family = str(product.get("family") or "DEFAULT")

        metrics = self._decision_log.get_learning_metrics(
            client=client, family=family, weeks=self.weeks
        )
        approval_rate = metrics.approval_rate

        checks = [
            (
                approval_rate > self.approval_threshold,
                f"aprovação {approval_rate:.0%} < {self.approval_threshold:.0%}",
            ),
            (is_make_to_stock, "produto não é make-to-stock"),
            (data_complete, "dados incompletos"),
            (capacity_ok, "capacidade não confirmada"),
            (material_ok, "matéria-prima insuficiente"),
            (financial_ok, "impacto financeiro acima do limite"),
            (no_quality_exceptions, "exceções de qualidade ativas"),
            (metrics.total_lines >= 5, "histórico insuficiente (<5 decisões)"),
        ]
        for ok, reason in checks:
            if not ok:
                self._audit(
                    client=client,
                    family=family,
                    plan_line_id=plan_line_id or None,
                    allowed=False,
                    approval_rate=approval_rate,
                    reason=reason,
                )
                return False, reason

        self._audit(
            client=client,
            family=family,
            plan_line_id=plan_line_id or None,
            allowed=True,
            approval_rate=approval_rate,
            reason="autonomia liberada",
        )
        return True, ""

    def _load_product(self, sku: str) -> dict[str, Any]:
        if not sku:
            return {}
        session = self._session_factory()
        try:
            row = session.execute(
                select(ProductModel).where(ProductModel.sku == sku)
            ).scalar_one_or_none()
            if row is None:
                return {}
            return {
                "sku": row.sku,
                "family": row.family,
                "active": row.active,
                "props": dict(row.props or {}),
            }
        except Exception as exc:
            logger.error("Falha ao carregar produto %s: %s", sku, exc)
            return {}
        finally:
            session.close()

    def _audit(
        self,
        *,
        client: str,
        family: str | None,
        plan_line_id: str | None,
        allowed: bool,
        approval_rate: float | None,
        reason: str,
    ) -> None:
        session = self._session_factory()
        try:
            session.add(
                AutonomyLogModel(
                    client=client,
                    family=family,
                    plan_line_id=plan_line_id,
                    allowed=allowed,
                    approval_rate=approval_rate,
                    reason=reason,
                )
            )
            session.commit()
            logger.info(
                "Autonomia client=%s family=%s allowed=%s rate=%s reason=%s",
                client,
                family,
                allowed,
                approval_rate,
                reason,
            )
        except Exception as exc:
            session.rollback()
            logger.error("Falha ao gravar autonomy_log: %s", exc)
        finally:
            session.close()
