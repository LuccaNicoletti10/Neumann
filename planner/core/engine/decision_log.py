"""Decision log — recomendações vs decisões vs actuals."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4


@dataclass
class DecisionRecord:
    id: UUID
    plan_run_id: UUID
    plan_line_id: str
    recommended_qty: float
    recommended_machine: str | None
    final_qty: float | None = None
    final_machine: str | None = None
    action_taken: str | None = None
    reason_code: str | None = None
    comment: str | None = None
    actor: str | None = None
    actor_type: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class LearningMetrics:
    approval_rate: float
    top_reason_codes: list[tuple[str, int]]
    total_lines: int


class DecisionLogService:
    def __init__(self) -> None:
        self._rows: list[DecisionRecord] = []

    def record_recommendation(
        self,
        plan_run_id: UUID,
        plan_line_id: str,
        recommended_qty: float,
        recommended_machine: str | None,
    ) -> DecisionRecord:
        row = DecisionRecord(
            id=uuid4(),
            plan_run_id=plan_run_id,
            plan_line_id=plan_line_id,
            recommended_qty=recommended_qty,
            recommended_machine=recommended_machine,
        )
        self._rows.append(row)
        return row

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
        for row in self._rows:
            if row.plan_line_id == plan_line_id:
                row.action_taken = action_taken
                row.actor = actor
                row.actor_type = actor_type
                row.reason_code = reason_code
                row.comment = comment
                row.final_qty = final_qty
                row.final_machine = final_machine
                return row
        raise KeyError(plan_line_id)

    def get_learning_metrics(self, weeks: int = 4) -> LearningMetrics:
        decided = [r for r in self._rows if r.action_taken]
        if not decided:
            return LearningMetrics(0.0, [], 0)
        approved = sum(1 for r in decided if r.action_taken == "approved")
        reasons: dict[str, int] = {}
        for r in decided:
            if r.reason_code:
                reasons[r.reason_code] = reasons.get(r.reason_code, 0) + 1
        top = sorted(reasons.items(), key=lambda x: -x[1])[:5]
        return LearningMetrics(approved / len(decided), top, len(decided))
