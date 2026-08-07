"""Autonomia limitada — privilégio conquistado por métrica."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FamilyAutonomyStatus:
    family: str
    eligible: bool
    approval_rate: float
    reason: str


class AutonomyService:
    def __init__(self, approval_threshold: float = 0.85) -> None:
        self.approval_threshold = approval_threshold

    def can_run_autonomous(
        self,
        *,
        approval_rate: float,
        is_make_to_stock: bool,
        data_complete: bool,
        capacity_ok: bool,
        material_ok: bool,
        financial_ok: bool,
        no_quality_exceptions: bool,
    ) -> tuple[bool, str]:
        checks = [
            (approval_rate > self.approval_threshold, f"aprovação {approval_rate:.0%} < {self.approval_threshold:.0%}"),
            (is_make_to_stock, "produto não é make-to-stock"),
            (data_complete, "dados incompletos"),
            (capacity_ok, "capacidade não confirmada"),
            (material_ok, "matéria-prima insuficiente"),
            (financial_ok, "impacto financeiro acima do limite"),
            (no_quality_exceptions, "exceções de qualidade ativas"),
        ]
        for ok, reason in checks:
            if not ok:
                return False, reason
        return True, ""

    def evaluate_family_eligibility(
        self, family: str, approval_rate: float
    ) -> FamilyAutonomyStatus:
        ok = approval_rate > self.approval_threshold
        return FamilyAutonomyStatus(
            family=family,
            eligible=ok,
            approval_rate=approval_rate,
            reason="" if ok else f"taxa de aprovação {approval_rate:.0%} insuficiente",
        )
