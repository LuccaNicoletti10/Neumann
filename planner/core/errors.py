"""Erros explícitos do planner — nunca plano silencioso com dado inventado."""

from __future__ import annotations


class PlannerError(Exception):
    """Erro base do planejador."""


class MissingDatasetError(PlannerError):
    """Dataset obrigatório ausente (RAW/Clean/Postgres)."""

    def __init__(self, dataset: str, detail: str = "") -> None:
        self.dataset = dataset
        msg = f"MissingDatasetError: {dataset}"
        if detail:
            msg = f"{msg} — {detail}"
        super().__init__(msg)


class InvalidDatasetError(PlannerError):
    """Dataset presente mas inválido (schema, snapshot, chaves)."""

    def __init__(self, dataset: str, detail: str = "") -> None:
        self.dataset = dataset
        msg = f"InvalidDatasetError: {dataset}"
        if detail:
            msg = f"{msg} — {detail}"
        super().__init__(msg)


class SyncCriticalError(PlannerError):
    """Falha crítica de sincronização — interrompe o plano."""


class SolverError(PlannerError):
    """Falha ou INFEASIBLE do scheduler."""


class DedupConflictError(InvalidDatasetError):
    """Chaves duplicadas com valores conflitantes — não apagar silenciosamente."""


class ForecastError(PlannerError):
    """Falha no forecast (statsforecast ausente/erro) em modo operacional."""


class ForecastBlockedError(PlannerError):
    """Forecast com WMAPE acima do limite — plano não deve ser emitido."""
