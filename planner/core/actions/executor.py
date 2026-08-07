"""Executor de actions — única porta de mudança com audit log."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .registry import ACTIONS


@dataclass
class ActionResult:
    success: bool
    action_type: str
    validations_result: list[dict[str, Any]] = field(default_factory=list)
    effects_result: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    audit_id: str | None = None


class ActionExecutor:
    def __init__(self) -> None:
        self.audit_log: list[dict[str, Any]] = []

    def execute(
        self,
        action_type: str,
        params: dict[str, Any],
        actor: str,
        actor_type: str,
    ) -> ActionResult:
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
                self._audit(result, params, actor, actor_type)
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
        self._audit(result, params, actor, actor_type)
        return result

    def _audit(
        self,
        result: ActionResult,
        params: dict[str, Any],
        actor: str,
        actor_type: str,
    ) -> None:
        self.audit_log.append(
            {
                "id": result.audit_id,
                "action_type": result.action_type,
                "params": params,
                "actor": actor,
                "actor_type": actor_type,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "validations_result": result.validations_result,
                "effects_result": result.effects_result,
                "success": result.success,
            }
        )
