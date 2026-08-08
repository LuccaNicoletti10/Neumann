"""Write-back TOTVS Protheus via arquivo monitorado (estratégia 2)."""

from __future__ import annotations

import csv
import hashlib
import logging
import os
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
    checksum: str | None = None
    errors: list[str] = field(default_factory=list)


class TotvsWriteBack:
    """
    Gera CSV de importação para pasta monitorada pelo ERP.

    Ordem: arquivo temp → fsync → rename atômico → só então marca exported.
    Estados: pending → file_created → exported.
    Idempotência via audit.write_back_log (Postgres).
    """

    def __init__(
        self,
        export_dir: str | Path,
        session_factory: sessionmaker[Session] | None = None,
    ) -> None:
        self.export_dir = Path(export_dir)
        self.export_dir.mkdir(parents=True, exist_ok=True)
        self._session_factory = session_factory or get_session_factory()
        self._log: dict[str, str] = {}

    def export_approved_orders(
        self,
        client: str,
        plan_run_id: UUID,
        orders: list[dict[str, Any]],
    ) -> WriteBackResult:
        result = WriteBackResult()
        rows: list[dict[str, Any]] = []
        pending_actions: list[tuple[str, str]] = []  # action_id, erp_number

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
                    pending_actions.append((action_id, erp_number))
                    self._record_export(
                        session, action_id, erp_number, status="pending", client=client
                    )
                result.exported += 1

            session.commit()
        except Exception as exc:
            session.rollback()
            logger.error("Falha no write-back (pending) client=%s: %s", client, exc)
            result.errors.append(str(exc))
            return result
        finally:
            session.close()

        if not rows:
            result.exported = 0
            return result

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        final_path = self.export_dir / f"{client}_{plan_run_id}_{stamp}.csv"
        tmp_path = final_path.with_suffix(".csv.tmp")

        try:
            with tmp_path.open("w", encoding="latin-1", newline="", errors="replace") as f:
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
                f.flush()
                os.fsync(f.fileno())

            # valida linhas
            with tmp_path.open("r", encoding="latin-1") as f:
                n_data = sum(1 for _ in f) - 1
            if n_data != len(rows):
                raise RuntimeError(
                    f"checksum linhas: esperado {len(rows)}, lido {n_data}"
                )

            checksum = hashlib.sha256(tmp_path.read_bytes()).hexdigest()
            os.replace(tmp_path, final_path)  # atômico no mesmo filesystem
            result.path = str(final_path)
            result.checksum = checksum

            # só agora marca exported
            session = self._session_factory()
            try:
                for action_id, erp_number in pending_actions:
                    self._update_status(
                        session,
                        action_id,
                        status="exported",
                        erp_order_number=erp_number,
                    )
                    self._log[action_id] = erp_number
                session.commit()
            except Exception as exc:
                session.rollback()
                result.errors.append(f"arquivo ok mas DB não confirmou: {exc}")
                logger.error("Write-back file_created sem confirm DB: %s", exc)
            finally:
                session.close()

        except Exception as exc:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            # reverte pending → não deixa como exported
            session = self._session_factory()
            try:
                for action_id, _erp in pending_actions:
                    self._delete_pending(session, action_id)
                session.commit()
            except Exception:
                session.rollback()
            finally:
                session.close()
            result.exported = 0
            result.errors.append(str(exc))
            logger.error("Falha ao escrever CSV write-back: %s", exc)
            return result

        logger.info(
            "Write-back exportado client=%s exported=%s skipped=%s path=%s checksum=%s",
            client,
            result.exported,
            result.skipped,
            result.path,
            result.checksum,
        )
        return result

    def _already_exported(self, session: Session, action_id: str) -> bool:
        if action_id in self._log:
            return True
        row = session.execute(
            select(WriteBackLogModel).where(WriteBackLogModel.action_id == action_id)
        ).scalar_one_or_none()
        if row is not None and row.status in {"exported", "file_created", "delivered", "confirmed"}:
            self._log[action_id] = row.erp_order_number or ""
            return True
        return False

    def _record_export(
        self,
        session: Session,
        action_id: str,
        erp_order_number: str,
        status: str,
        client: str = "default",
    ) -> None:
        existing = session.execute(
            select(WriteBackLogModel).where(WriteBackLogModel.action_id == action_id)
        ).scalar_one_or_none()
        if existing is not None:
            existing.status = status
            existing.erp_order_number = erp_order_number
            existing.exported_at = datetime.now(timezone.utc)
            return
        kwargs: dict[str, Any] = {
            "action_id": action_id,
            "erp_order_number": erp_order_number,
            "exported_at": datetime.now(timezone.utc),
            "status": status,
        }
        # client_id opcional (migração 004)
        if hasattr(WriteBackLogModel, "client_id"):
            kwargs["client_id"] = client
        session.add(WriteBackLogModel(**kwargs))

    def _update_status(
        self,
        session: Session,
        action_id: str,
        status: str,
        erp_order_number: str,
    ) -> None:
        row = session.execute(
            select(WriteBackLogModel).where(WriteBackLogModel.action_id == action_id)
        ).scalar_one_or_none()
        if row is None:
            session.add(
                WriteBackLogModel(
                    action_id=action_id,
                    erp_order_number=erp_order_number,
                    exported_at=datetime.now(timezone.utc),
                    status=status,
                )
            )
            return
        row.status = status
        row.erp_order_number = erp_order_number
        row.exported_at = datetime.now(timezone.utc)

    def _delete_pending(self, session: Session, action_id: str) -> None:
        row = session.execute(
            select(WriteBackLogModel).where(WriteBackLogModel.action_id == action_id)
        ).scalar_one_or_none()
        if row is not None and row.status == "pending":
            session.delete(row)
