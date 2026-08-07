"""Narrador do plano — LLM apenas narra/explica; nunca escreve no banco nem calcula."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy.orm import Session, sessionmaker

from planner.core.db import get_session_factory
from planner.core.engine.explain import PlanExplanation
from planner.core.engine.models import LlmLogModel
from planner.core.engine.scheduler import Schedule

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Você é um assistente de planejamento de produção têxtil. "
    "Você apenas NARRA e EXPLICA. Você NÃO calcula quantidades, "
    "NÃO altera dados, NÃO toma decisões. Toda sugestão deve ser "
    "formatada como uma action proposta."
)

# ~$3 / 1M input + $15 / 1M output (ordem de grandeza Sonnet)
_COST_PER_INPUT_TOKEN = 3e-6
_COST_PER_OUTPUT_TOKEN = 15e-6


@dataclass
class ExceptionTriage:
    severity: str
    category: str
    explanation: str
    suggested_action: dict[str, Any]


class PlanNarrator:
    """
    Narra o plano em linguagem natural.

    Se ANTHROPIC_API_KEY existir, chama Claude; senão, fallback determinístico.
    Toda chamada é logada em audit.llm_log. LLM nunca grava ontology/decisions.
    """

    def __init__(
        self,
        api_key: str | None = None,
        session_factory: sessionmaker[Session] | None = None,
        anthropic_client_factory: Callable[[str], Any] | None = None,
    ) -> None:
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self._session_factory = session_factory or get_session_factory()
        self._client_factory = anthropic_client_factory
        self.llm_log: list[dict[str, Any]] = []

    def narrate_plan(
        self,
        plan: Schedule,
        explanations: list[PlanExplanation],
        client: str,
    ) -> str:
        user_prompt = self._build_user_prompt(plan, explanations, client)
        if not self.api_key:
            text = self._deterministic_fallback(plan, explanations, client)
            self._log_call(user_prompt, text, tokens=len(text.split()), cost=0.0, mode="fallback")
            return text

        try:
            text, tokens, cost = self._call_anthropic(user_prompt)
            self._log_call(user_prompt, text, tokens=tokens, cost=cost, mode="anthropic")
            return text
        except Exception as exc:
            logger.error("Falha na chamada Anthropic — usando fallback: %s", exc)
            text = self._deterministic_fallback(plan, explanations, client)
            self._log_call(
                user_prompt,
                text,
                tokens=len(text.split()),
                cost=0.0,
                mode=f"fallback_after_error:{exc}",
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

    def _build_user_prompt(
        self, plan: Schedule, explanations: list[PlanExplanation], client: str
    ) -> str:
        lines = [
            f"Cliente: {client}",
            f"Status do solver: {plan.solver_status}",
            f"Ordens: {len(plan.assignments)}",
            "Explique o plano de forma clara para o planejador humano:",
        ]
        for exp in explanations:
            reason = exp.reasons[0].message if exp.reasons else ""
            lines.append(
                f"- {exp.order}: qty={exp.qty:g} sku={exp.sku} máquina={exp.machine} "
                f"janela={exp.window[0]}→{exp.window[1]} motivo={reason}"
            )
        return "\n".join(lines)

    def _deterministic_fallback(
        self, plan: Schedule, explanations: list[PlanExplanation], client: str
    ) -> str:
        lines = [f"Plano de produção ({client}) — {len(plan.assignments)} ordens:"]
        for exp in explanations:
            reason = exp.reasons[0].message if exp.reasons else ""
            lines.append(
                f"- {exp.order}: {exp.qty:g} de {exp.sku} na {exp.machine} "
                f"({exp.window[0]}→{exp.window[1]}). {reason}"
            )
        return "\n".join(lines)

    def _call_anthropic(self, user_prompt: str) -> tuple[str, int, float]:
        if self._client_factory:
            client = self._client_factory(self.api_key or "")
        else:
            import anthropic

            client = anthropic.Anthropic(api_key=self.api_key)

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=500,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text_parts = []
        for block in response.content:
            if hasattr(block, "text"):
                text_parts.append(block.text)
            elif isinstance(block, dict) and "text" in block:
                text_parts.append(block["text"])
        text = "\n".join(text_parts) or str(response.content)
        usage = getattr(response, "usage", None)
        in_tok = int(getattr(usage, "input_tokens", 0) or 0)
        out_tok = int(getattr(usage, "output_tokens", 0) or 0)
        tokens = in_tok + out_tok
        cost = in_tok * _COST_PER_INPUT_TOKEN + out_tok * _COST_PER_OUTPUT_TOKEN
        return text, tokens, cost

    def _log_call(
        self,
        prompt: str,
        response: str,
        *,
        tokens: int,
        cost: float,
        mode: str,
    ) -> None:
        entry = {
            "prompt": prompt,
            "response": response,
            "tokens": tokens,
            "cost": cost,
            "mode": mode,
        }
        self.llm_log.append(entry)

        session = self._session_factory()
        try:
            session.add(
                LlmLogModel(
                    prompt=f"[{mode}]\n{SYSTEM_PROMPT}\n---\n{prompt}",
                    response=response,
                    tokens=tokens,
                    cost=cost,
                )
            )
            session.commit()
        except Exception as exc:
            session.rollback()
            logger.error("Falha ao gravar audit.llm_log: %s", exc)
        finally:
            session.close()
