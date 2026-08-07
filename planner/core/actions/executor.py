"""Executor de actions — única porta de mudança com audit log no PostgreSQL."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planner.core.db import get_session_factory

from .models import ActionLogModel
from .registry import ACTIONS

logger = logging.getLogger(__name__)


@dataclass
class ActionResult:
    """Resultado de uma Action (sucesso ou falha de validação/efeito)."""

    success: bool
    action_type: str
    validations_result: list[dict[str, Any]] = field(default_factory=list)
    effects_result: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    audit_id: str | None = None


class ActionExecutor:
    """
    Executa Actions do registry e grava audit.action_log.

    A execução e o INSERT de audit preferem a mesma transação. Se o audit
    falhar, a action já concluída não é revertida — apenas log ERROR.
    """

    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        self._session_factory = session_factory or get_session_factory()
        # Mantido para compatibilidade com código que ainda lê memória
        self.audit_log: list[dict[str, Any]] = []

    def execute(
        self,
        action_type: str,
        params: dict[str, Any],
        actor: str,
        actor_type: str,
        *,
        plan_run_id: UUID | str | None = None,
        client: str | None = None,
    ) -> ActionResult:
        """Valida, aplica effects e audita a Action."""
        action = ACTIONS.get(action_type)
        if not action:
            return ActionResult(False, action_type, error=f"Action desconhecida: {action_type}")

        validations: list[dict[str, Any]] = []
        for validate in action.validations:
            ok, msg = validate(params)
            validations.append({"ok": ok, "message": msg})
            if not ok:
                result = ActionResult(
                    False,
                    action_type,
                    validations_result=validations,
                    error=msg,
                    audit_id=str(uuid4()),
                )
                self._persist_audit(result, params, actor, actor_type, plan_run_id, client)
                return result

        effects: list[dict[str, Any]] = []
        for effect in action.effects:
            effects.append(effect(params, actor))

        result = ActionResult(
            True,
            action_type,
            validations_result=validations,
            effects_result=effects,
            audit_id=str(uuid4()),
        )
        self._persist_audit(result, params, actor, actor_type, plan_run_id, client)
        return result

    def get_audit_log(self, client: str, limit: int = 100) -> list[dict[str, Any]]:
        """
        Consulta recentes em audit.action_log.

        `client` filtra via params->>'client' quando presente; senão retorna
        os últimos `limit` registros (MVP sem coluna client dedicada).
        """
        session = self._session_factory()
        try:
            rows = session.execute(
                select(ActionLogModel).order_by(ActionLogModel.timestamp.desc()).limit(limit * 3)
            ).scalars().all()
            out: list[dict[str, Any]] = []
            for row in rows:
                params = row.params or {}
                if client and params.get("client") not in (None, client):
                    # inclui também linhas sem client no params (legado/MVP)
                    if "client" in params:
                        continue
                out.append(
                    {
                        "id": str(row.id),
                        "action_type": row.action_type,
                        "params": params,
                        "actor": row.actor,
                        "actor_type": row.actor_type,
                        "timestamp": row.timestamp.isoformat() if row.timestamp else None,
                        "validations_result": row.validations_result,
                        "effects_result": row.effects_result,
                        "plan_run_id": str(row.plan_run_id) if row.plan_run_id else None,
                        "success": row.success,
                    }
                )
                if len(out) >= limit:
                    break
            return out
        except Exception as exc:
            logger.error("Falha ao consultar audit log client=%s: %s", client, exc)
            return list(self.audit_log[-limit:])
        finally:
            session.close()

    def _persist_audit(
        self,
        result: ActionResult,
        params: dict[str, Any],
        actor: str,
        actor_type: str,
        plan_run_id: UUID | str | None,
        client: str | None,
    ) -> None:
        audit_id = UUID(result.audit_id) if result.audit_id else uuid4()
        result.audit_id = str(audit_id)
        payload_params = dict(params)
        if client and "client" not in payload_params:
            payload_params["client"] = client

        memory_row = {
            "id": str(audit_id),
            "action_type": result.action_type,
            "params": payload_params,
            "actor": actor,
            "actor_type": actor_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "validations_result": result.validations_result,
            "effects_result": result.effects_result,
            "plan_run_id": str(plan_run_id) if plan_run_id else None,
            "success": result.success,
        }
        self.audit_log.append(memory_row)

        session = self._session_factory()
        try:
            pr_id: UUID | None = None
            if plan_run_id is not None:
                pr_id = plan_run_id if isinstance(plan_run_id, UUID) else UUID(str(plan_run_id))
            session.add(
                ActionLogModel(
                    id=audit_id,
                    action_type=result.action_type,
                    params=payload_params,
                    actor=actor,
                    actor_type=actor_type,
                    timestamp=datetime.now(timezone.utc),
                    validations_result=result.validations_result,
                    effects_result=result.effects_result,
                    plan_run_id=pr_id,
                    success=result.success,
                )
            )
            session.commit()
            logger.info(
                "Action auditada type=%s success=%s actor=%s id=%s",
                result.action_type,
                result.success,
                actor,
                audit_id,
            )
        except Exception as exc:
            session.rollback()
            logger.error(
                "Falha ao gravar audit.action_log (action segue válida) type=%s id=%s: %s",
                result.action_type,
                audit_id,
                exc,
            )
        finally:
            session.close()
