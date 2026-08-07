"""Registry de Action Types (Foundry-style)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


ValidationFn = Callable[[dict[str, Any]], tuple[bool, str]]
EffectFn = Callable[[dict[str, Any], str], dict[str, Any]]


@dataclass
class Action:
    name: str
    params: dict[str, type]
    validations: list[ValidationFn] = field(default_factory=list)
    effects: list[EffectFn] = field(default_factory=list)


def _line_exists(params: dict[str, Any]) -> tuple[bool, str]:
    if not params.get("plan_line_id"):
        return False, "plan_line_id obrigatório"
    return True, ""


def _reason_required(params: dict[str, Any]) -> tuple[bool, str]:
    if not params.get("reason_code"):
        return False, "reason_code obrigatório"
    return True, ""


def _mark_approved(params: dict[str, Any], actor: str) -> dict[str, Any]:
    return {"status": "approved", "actor": actor, "plan_line_id": params["plan_line_id"]}


def _log_override(params: dict[str, Any], actor: str) -> dict[str, Any]:
    return {
        "status": "modified",
        "actor": actor,
        "new_qty": params.get("new_qty"),
        "reason_code": params.get("reason_code"),
    }


def _mark_rejected(params: dict[str, Any], actor: str) -> dict[str, Any]:
    return {"status": "rejected", "actor": actor, "reason_code": params.get("reason_code")}


def _mark_ack(params: dict[str, Any], actor: str) -> dict[str, Any]:
    return {"status": "acknowledged", "exception_id": params.get("exception_id"), "actor": actor}


ACTIONS: dict[str, Action] = {
    "approve_plan_line": Action(
        name="approve_plan_line",
        params={"plan_line_id": str, "approver": str},
        validations=[_line_exists],
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
        validations=[_line_exists, _reason_required],
        effects=[_log_override],
    ),
    "reject_plan_line": Action(
        name="reject_plan_line",
        params={"plan_line_id": str, "reason_code": str, "comment": str},
        validations=[_line_exists, _reason_required],
        effects=[_mark_rejected],
    ),
    "acknowledge_exception": Action(
        name="acknowledge_exception",
        params={"exception_id": str, "comment": str},
        validations=[lambda p: (bool(p.get("exception_id")), "exception_id obrigatório")],
        effects=[_mark_ack],
    ),
}
