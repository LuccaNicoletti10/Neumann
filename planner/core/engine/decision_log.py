"""Decision log — recomendações vs decisões vs actuals (PostgreSQL)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from planner.core.db import get_session_factory
from planner.core.engine.models import DecisionLogModel

logger = logging.getLogger(__name__)


@dataclass
class DecisionRecord:
    """Registro de domínio (espelha decisions.decision_log)."""

    id: UUID
    plan_run_id: UUID
    plan_line_id: str
    recommended_qty: float
    recommended_machine: str | None
    client: str = ""
    family: str | None = None
    final_qty: float | None = None
    final_machine: str | None = None
    action_taken: str | None = None
    reason_code: str | None = None
    comment: str | None = None
    actor: str | None = None
    actor_type: str | None = None
    actual_qty: float | None = None
    actual_scrap: float | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class LearningMetrics:
    """Métricas agregadas para autonomia / aprendizado."""

    approval_rate: float
    top_reason_codes: list[tuple[str, int]]
    total_lines: int
    weeks: int = 4
    family: str | None = None
    client: str | None = None


class DecisionLogService:
    """
    Persiste o ciclo recomendação → decisão → actuals no Postgres.

    Fonte da verdade: decisions.decision_log (não lista em memória).
    """

    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        self._session_factory = session_factory or get_session_factory()

    def record_recommendation(
        self,
        plan_run_id: UUID,
        plan_line_id: str,
        recommended_qty: float,
        recommended_machine: str | None,
        *,
        client: str,
        family: str | None = None,
    ) -> DecisionRecord:
        """INSERT da recomendação do motor."""
        row_id = uuid4()
        session = self._session_factory()
        try:
            session.add(
                DecisionLogModel(
                    id=row_id,
                    client=client,
                    family=family,
                    plan_run_id=plan_run_id,
                    plan_line_id=plan_line_id,
                    recommended_qty=recommended_qty,
                    recommended_machine=recommended_machine,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()
            logger.info(
                "Recomendação registrada plan_line=%s qty=%.2f machine=%s",
                plan_line_id,
                recommended_qty,
                recommended_machine,
            )
            return DecisionRecord(
                id=row_id,
                plan_run_id=plan_run_id,
                plan_line_id=plan_line_id,
                recommended_qty=recommended_qty,
                recommended_machine=recommended_machine,
                client=client,
                family=family,
            )
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def record_decision(
        self,
        plan_line_id: str,
        action_taken: str,
        actor: str,
        actor_type: str,
        reason_code: str | None = None,
        comment: str | None = None,
        final_qty: float | None = None,
        final_machine: str | None = None,
    ) -> DecisionRecord:
        """UPDATE da decisão humana (aprovação / modificação / rejeição)."""
        session = self._session_factory()
        try:
            result = session.execute(
                update(DecisionLogModel)
                .where(DecisionLogModel.plan_line_id == plan_line_id)
                .values(
                    action_taken=action_taken,
                    actor=actor,
                    actor_type=actor_type,
                    reason_code=reason_code,
                    comment=comment,
                    final_qty=final_qty,
                    final_machine=final_machine,
                    decided_at=datetime.now(timezone.utc),
                )
                .returning(DecisionLogModel)
            )
            row = result.scalar_one_or_none()
            if row is None:
                session.rollback()
                raise KeyError(plan_line_id)
            session.commit()
            return _to_record(row)
        except KeyError:
            raise
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def record_actuals(
        self,
        plan_line_id: str,
        actual_qty: float,
        actual_scrap: float | None = None,
    ) -> DecisionRecord:
        """UPDATE com actuals de chão de fábrica."""
        session = self._session_factory()
        try:
            result = session.execute(
                update(DecisionLogModel)
                .where(DecisionLogModel.plan_line_id == plan_line_id)
                .values(actual_qty=actual_qty, actual_scrap=actual_scrap)
                .returning(DecisionLogModel)
            )
            row = result.scalar_one_or_none()
            if row is None:
                session.rollback()
                raise KeyError(plan_line_id)
            session.commit()
            return _to_record(row)
        except KeyError:
            raise
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_learning_metrics(
        self,
        client: str | None = None,
        family: str | None = None,
        weeks: int = 4,
    ) -> LearningMetrics:
        """
        Agrega métricas no SQL (GROUP BY) — não carrega todas as linhas.
        """
        session = self._session_factory()
        try:
            since = datetime.now(timezone.utc) - timedelta(weeks=weeks)
            filters = [
                DecisionLogModel.action_taken.is_not(None),
                DecisionLogModel.created_at >= since,
            ]
            if client:
                filters.append(DecisionLogModel.client == client)
            if family:
                filters.append(DecisionLogModel.family == family)

            totals = session.execute(
                select(
                    func.count().label("total"),
                    func.sum(
                        case(
                            (DecisionLogModel.action_taken == "approved", 1),
                            else_=0,
                        )
                    ).label("approved"),
                ).where(*filters)
            ).one()
            total = int(totals.total or 0)
            approved = int(totals.approved or 0)
            rate = (approved / total) if total else 0.0

            reason_rows = session.execute(
                select(DecisionLogModel.reason_code, func.count().label("n"))
                .where(*filters, DecisionLogModel.reason_code.is_not(None))
                .group_by(DecisionLogModel.reason_code)
                .order_by(func.count().desc())
                .limit(5)
            ).all()
            top = [(str(r.reason_code), int(r.n)) for r in reason_rows]

            return LearningMetrics(
                approval_rate=rate,
                top_reason_codes=top,
                total_lines=total,
                weeks=weeks,
                family=family,
                client=client,
            )
        finally:
            session.close()


def _to_record(row: DecisionLogModel) -> DecisionRecord:
    return DecisionRecord(
        id=row.id,
        plan_run_id=row.plan_run_id,
        plan_line_id=row.plan_line_id,
        recommended_qty=row.recommended_qty,
        recommended_machine=row.recommended_machine,
        client=row.client,
        family=row.family,
        final_qty=row.final_qty,
        final_machine=row.final_machine,
        action_taken=row.action_taken,
        reason_code=row.reason_code,
        comment=row.comment,
        actor=row.actor,
        actor_type=row.actor_type,
        actual_qty=row.actual_qty,
        actual_scrap=row.actual_scrap,
        created_at=row.created_at,
    )
