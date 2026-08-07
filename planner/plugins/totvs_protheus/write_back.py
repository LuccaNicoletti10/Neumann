"""Write-back TOTVS Protheus via arquivo monitorado (estratégia 2)."""

from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planner.core.db import get_session_factory
from planner.core.engine.models import WriteBackLogModel

logger = logging.getLogger(__name__)


@dataclass
class WriteBackResult:
    exported: int = 0
    skipped: int = 0
    path: str | None = None
    errors: list[str] = field(default_factory=list)


class TotvsWriteBack:
    """
    Gera CSV de importação para pasta monitorada pelo ERP.

    Idempotência via audit.write_back_log (Postgres).
    NUNCA faz INSERT direto nas tabelas SB2/SC2.
    """

    def __init__(
        self,
        export_dir: str | Path,
        session_factory: sessionmaker[Session] | None = None,
    ) -> None:
        self.export_dir = Path(export_dir)
        self.export_dir.mkdir(parents=True, exist_ok=True)
        self._session_factory = session_factory or get_session_factory()
        # cache local opcional; fonte da verdade é o Postgres
        self._log: dict[str, str] = {}

    def export_approved_orders(
        self,
        client: str,
        plan_run_id: UUID,
        orders: list[dict[str, Any]],
    ) -> WriteBackResult:
        result = WriteBackResult()
        rows: list[dict[str, Any]] = []
        session = self._session_factory()
        try:
            for order in orders:
                action_id = str(order.get("action_id", "")).strip()
                if action_id and self._already_exported(session, action_id):
                    result.skipped += 1
                    logger.info("Write-back pulado (já exportado) action_id=%s", action_id)
                    continue

                erp_number = f"OP-{plan_run_id.hex[:8]}-{len(rows)+1:03d}"
                rows.append(
                    {
                        "acao": "I",
                        "produto": order["sku"],
                        "quantidade": order["qty"],
                        "data_inicio": str(order["start"]).replace("-", ""),
                        "data_fim": str(order["end"]).replace("-", ""),
                        "maquina": order["machine"],
                        "observacao": f"Gerado pelo Planner v1.0 | Action: {action_id}",
                    }
                )
                if action_id:
                    self._record_export(session, action_id, erp_number, status="exported")
                    self._log[action_id] = erp_number
                result.exported += 1

            session.commit()
        except Exception as exc:
            session.rollback()
            logger.error("Falha no write-back client=%s: %s", client, exc)
            result.errors.append(str(exc))
            return result
        finally:
            session.close()

        if not rows:
            return result

        path = (
            self.export_dir
            / f"{client}_{plan_run_id}_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.csv"
        )
        # Protheus BR: Latin-1 + ponto-e-vírgula
        with path.open("w", encoding="latin-1", newline="", errors="replace") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "acao",
                    "produto",
                    "quantidade",
                    "data_inicio",
                    "data_fim",
                    "maquina",
                    "observacao",
                ],
                delimiter=";",
            )
            writer.writeheader()
            writer.writerows(rows)
        result.path = str(path)
        logger.info(
            "Write-back exportado client=%s exported=%s skipped=%s path=%s",
            client,
            result.exported,
            result.skipped,
            result.path,
        )
        return result

    def _already_exported(self, session: Session, action_id: str) -> bool:
        if action_id in self._log:
            return True
        row = session.execute(
            select(WriteBackLogModel).where(WriteBackLogModel.action_id == action_id)
        ).scalar_one_or_none()
        if row is not None:
            self._log[action_id] = row.erp_order_number or ""
            return True
        return False

    def _record_export(
        self, session: Session, action_id: str, erp_order_number: str, status: str
    ) -> None:
        existing = session.execute(
            select(WriteBackLogModel).where(WriteBackLogModel.action_id == action_id)
        ).scalar_one_or_none()
        if existing is not None:
            return
        session.add(
            WriteBackLogModel(
                action_id=action_id,
                erp_order_number=erp_order_number,
                exported_at=datetime.now(timezone.utc),
                status=status,
            )
        )
