"""Registry de Action Types — validações de domínio + efeitos reais no Postgres."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import text

from planner.core.db import get_session_factory
from planner.core.engine.decision_log import DecisionLogService


ValidationFn = Callable[[dict[str, Any]], tuple[bool, str]]
EffectFn = Callable[[dict[str, Any], str], dict[str, Any]]


@dataclass
class Action:
    name: str
    params: dict[str, type]
    validations: list[ValidationFn] = field(default_factory=list)
    effects: list[EffectFn] = field(default_factory=list)


def _line_exists(params: dict[str, Any]) -> tuple[bool, str]:
    plan_line_id = params.get("plan_line_id")
    if not plan_line_id:
        return False, "plan_line_id obrigatório"
    factory = get_session_factory()
    session = factory()
    try:
        row = session.execute(
            text("SELECT id, status FROM decisions.plan_line WHERE id = :id"),
            {"id": str(plan_line_id)},
        ).mappings().first()
        if row is None:
            return False, f"plan_line inexistente: {plan_line_id}"
        params["_plan_line_status"] = row["status"]
        return True, ""
    except Exception as exc:
        return False, f"falha ao validar plan_line: {exc}"
    finally:
        session.close()


def _line_pending(params: dict[str, Any]) -> tuple[bool, str]:
    status = params.get("_plan_line_status") or ""
    if status and status not in {"proposed", "pending", "suggested"}:
        return False, f"plan_line não está pendente (status={status})"
    return True, ""


def _approver_role(params: dict[str, Any]) -> tuple[bool, str]:
    role = str(params.get("actor_role") or params.get("role") or "approver").lower()
    if role not in {"approver", "planner", "admin", "human"}:
        return False, f"papel insuficiente para aprovar: {role}"
    return True, ""


def _reason_required(params: dict[str, Any]) -> tuple[bool, str]:
    if not params.get("reason_code"):
        return False, "reason_code obrigatório"
    return True, ""


def _lot_multiple_ok(params: dict[str, Any]) -> tuple[bool, str]:
    new_qty = params.get("new_qty")
    lot = params.get("lot_multiple")
    if new_qty is None or lot in (None, "", 0):
        return True, ""
    try:
        q = float(new_qty)
        m = float(lot)
        if m > 0 and abs(q % m) > 1e-6:
            return False, f"qty {q} não é múltiplo do lote {m}"
    except (TypeError, ValueError):
        return False, "new_qty/lot_multiple inválidos"
    return True, ""


def _update_plan_line_status(plan_line_id: str, status: str, extra: dict[str, Any] | None = None) -> None:
    factory = get_session_factory()
    session = factory()
    try:
        sets = ["status = :status"]
        payload: dict[str, Any] = {"id": plan_line_id, "status": status}
        if extra:
            if "qty" in extra:
                sets.append("qty = :qty")
                payload["qty"] = extra["qty"]
            if "machine_id" in extra:
                sets.append("machine_id = :machine_id")
                payload["machine_id"] = extra["machine_id"]
        session.execute(
            text(f"UPDATE decisions.plan_line SET {', '.join(sets)} WHERE id = :id"),
            payload,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _mark_approved(params: dict[str, Any], actor: str) -> dict[str, Any]:
    plan_line_id = str(params["plan_line_id"])
    _update_plan_line_status(plan_line_id, "approved")
    DecisionLogService().record_decision(
        plan_line_id,
        action_taken="approved",
        actor=actor,
        actor_type=str(params.get("actor_type") or "human"),
        final_qty=params.get("final_qty"),
        final_machine=params.get("final_machine"),
    )
    return {"status": "approved", "actor": actor, "plan_line_id": plan_line_id}


def _log_override(params: dict[str, Any], actor: str) -> dict[str, Any]:
    plan_line_id = str(params["plan_line_id"])
    extra = {}
    if params.get("new_qty") is not None:
        extra["qty"] = float(params["new_qty"])
    if params.get("new_machine"):
        extra["machine_id"] = str(params["new_machine"])
    _update_plan_line_status(plan_line_id, "modified", extra)
    DecisionLogService().record_decision(
        plan_line_id,
        action_taken="modified",
        actor=actor,
        actor_type=str(params.get("actor_type") or "human"),
        reason_code=params.get("reason_code"),
        comment=params.get("comment"),
        final_qty=params.get("new_qty"),
        final_machine=params.get("new_machine"),
    )
    return {
        "status": "modified",
        "actor": actor,
        "new_qty": params.get("new_qty"),
        "reason_code": params.get("reason_code"),
        "plan_line_id": plan_line_id,
    }


def _mark_rejected(params: dict[str, Any], actor: str) -> dict[str, Any]:
    plan_line_id = str(params["plan_line_id"])
    _update_plan_line_status(plan_line_id, "rejected")
    DecisionLogService().record_decision(
        plan_line_id,
        action_taken="rejected",
        actor=actor,
        actor_type=str(params.get("actor_type") or "human"),
        reason_code=params.get("reason_code"),
        comment=params.get("comment"),
    )
    return {
        "status": "rejected",
        "actor": actor,
        "reason_code": params.get("reason_code"),
        "plan_line_id": plan_line_id,
    }


def _mark_ack(params: dict[str, Any], actor: str) -> dict[str, Any]:
    return {
        "status": "acknowledged",
        "exception_id": params.get("exception_id"),
        "actor": actor,
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }


ACTIONS: dict[str, Action] = {
    "approve_plan_line": Action(
        name="approve_plan_line",
        params={"plan_line_id": str, "approver": str},
        validations=[_line_exists, _line_pending, _approver_role],
        effects=[_mark_approved],
    ),
    "modify_plan_line": Action(
        name="modify_plan_line",
        params={
            "plan_line_id": str,
            "new_qty": float,
            "new_machine": str,
            "reason_code": str,
            "comment": str,
        },
        validations=[_line_exists, _line_pending, _reason_required, _lot_multiple_ok],
        effects=[_log_override],
    ),
    "reject_plan_line": Action(
        name="reject_plan_line",
        params={"plan_line_id": str, "reason_code": str, "comment": str},
        validations=[_line_exists, _line_pending, _reason_required],
        effects=[_mark_rejected],
    ),
    "acknowledge_exception": Action(
        name="acknowledge_exception",
        params={"exception_id": str, "comment": str},
        validations=[lambda p: (bool(p.get("exception_id")), "exception_id obrigatório")],
        effects=[_mark_ack],
    ),
}
