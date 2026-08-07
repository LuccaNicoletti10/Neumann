"""Narrador do plano — LLM apenas narra/explica; nunca escreve no banco."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from planner.core.engine.explain import PlanExplanation
from planner.core.engine.scheduler import Schedule

SYSTEM_PROMPT = (
    "Você é um assistente de planejamento de produção têxtil. "
    "Você apenas NARRA e EXPLICA. Você NÃO calcula quantidades, "
    "NÃO altera dados, NÃO toma decisões. Toda sugestão deve ser "
    "formatada como uma action proposta."
)


@dataclass
class ExceptionTriage:
    severity: str
    category: str
    explanation: str
    suggested_action: dict[str, Any]


class PlanNarrator:
    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.llm_log: list[dict[str, Any]] = []

    def narrate_plan(
        self,
        plan: Schedule,
        explanations: list[PlanExplanation],
        client: str,
    ) -> str:
        lines = [f"Plano de produção ({client}) — {len(plan.assignments)} ordens:"]
        for exp in explanations:
            reason = exp.reasons[0].message if exp.reasons else ""
            lines.append(
                f"- {exp.order}: {exp.qty:g} de {exp.sku} na {exp.machine} "
                f"({exp.window[0]}→{exp.window[1]}). {reason}"
            )
        text = "\n".join(lines)
        self.llm_log.append(
            {
                "prompt": SYSTEM_PROMPT,
                "response": text,
                "tokens": len(text.split()),
                "mode": "deterministic_fallback",
            }
        )
        return text

    def triage_exception(self, anomaly: dict[str, Any], context: str) -> ExceptionTriage:
        category = str(anomaly.get("type", "unknown"))
        severity = "high" if category in {"stockout_risk", "demand_spike"} else "medium"
        return ExceptionTriage(
            severity=severity,
            category=category,
            explanation=f"{anomaly.get('message', '')} | contexto: {context[:200]}",
            suggested_action={
                "type": "acknowledge_exception",
                "params": {"exception_id": anomaly.get("id"), "comment": "revisar"},
                "reason": category,
            },
        )
