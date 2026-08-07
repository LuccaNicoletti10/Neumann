"""Alertas operacionais — MVP loga em stdout; futuro: webhook Slack/Teams."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def send_alert(
    level: str,
    component: str,
    message: str,
    client: str,
) -> dict[str, Any]:
    """
    Emite alerta ruidoso para falhas que não devem gerar plano silencioso.

    level: ERROR | WARNING | CRITICAL
    """
    alert = {
        "level": level.upper(),
        "component": component,
        "message": message,
        "client": client,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    text = (
        f"[ALERTA {alert['level']}] client={client} component={component}: {message}"
    )
    if alert["level"] in {"ERROR", "CRITICAL"}:
        logger.error(text)
    else:
        logger.warning(text)
    return alert


def alert_pipeline_failure(client: str, exc: BaseException) -> dict[str, Any]:
    return send_alert("ERROR", "pipeline", f"Pipeline falhou: {exc}", client)


def alert_connector_failure(client: str, connector: str, attempts: int) -> dict[str, Any]:
    return send_alert(
        "ERROR",
        "connector",
        f"Conector {connector} sem resposta após {attempts} tentativas",
        client,
    )


def alert_high_wmape(client: str, sku: str, wmape: float) -> dict[str, Any]:
    return send_alert(
        "WARNING",
        "forecast",
        f"WMAPE alto para SKU {sku}: {wmape:.1%}",
        client,
    )


def alert_solver_infeasible(client: str) -> dict[str, Any]:
    return send_alert(
        "ERROR",
        "scheduler",
        "Solver retornou INFEASIBLE — plano não emitido",
        client,
    )
