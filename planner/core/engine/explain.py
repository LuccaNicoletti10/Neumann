"""Explicações estruturadas de decisões do plano (dado, não prosa)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .netting import NettingResult
from .scheduler import Assignment, SchedulingProblem


@dataclass
class Reason:
    type: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class PlanExplanation:
    order: str
    sku: str
    qty: float
    machine: str
    window: list[str]
    reasons: list[Reason]


def explain_plan_line(
    assignment: Assignment,
    problem: SchedulingProblem,
    netting_result: NettingResult,
) -> PlanExplanation:
    order = next(o for o in problem.orders if o.id == assignment.order_id)
    reasons = [
        Reason(
            type="stockout_risk",
            message=netting_result.reason,
            data={
                "days_of_cover_hint": netting_result.reason,
                "net_requirement": netting_result.net_requirement,
            },
        ),
        Reason(
            type="machine_choice",
            message=f"Máquina {assignment.machine_id} selecionada para {order.sku}",
            data={"chosen": assignment.machine_id, "family": order.family},
        ),
        Reason(
            type="priority",
            message=f"Prioridade {order.priority:.2f} (risco de ruptura)",
            data={"priority": order.priority, "deadline": order.deadline.isoformat()},
        ),
    ]
    return PlanExplanation(
        order=assignment.order_id,
        sku=order.sku,
        qty=assignment.qty,
        machine=assignment.machine_id,
        window=[assignment.start.date().isoformat(), assignment.end.date().isoformat()],
        reasons=reasons,
    )
