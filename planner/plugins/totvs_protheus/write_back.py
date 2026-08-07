"""Write-back TOTVS Protheus via arquivo monitorado (estratégia 2)."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID


@dataclass
class WriteBackResult:
    exported: int = 0
    skipped: int = 0
    path: str | None = None
    errors: list[str] = field(default_factory=list)


class TotvsWriteBack:
    """
    Gera CSV de importação para pasta monitorada pelo ERP.

    NUNCA faz INSERT direto nas tabelas SB2/SC2.
    """

    def __init__(self, export_dir: str | Path) -> None:
        self.export_dir = Path(export_dir)
        self.export_dir.mkdir(parents=True, exist_ok=True)
        self._log: dict[str, str] = {}  # action_id -> erp_order_number

    def export_approved_orders(
        self,
        client: str,
        plan_run_id: UUID,
        orders: list[dict[str, Any]],
    ) -> WriteBackResult:
        result = WriteBackResult()
        rows: list[dict[str, Any]] = []
        for order in orders:
            action_id = str(order.get("action_id", ""))
            if action_id and action_id in self._log:
                result.skipped += 1
                continue
            erp_number = f"OP-{plan_run_id.hex[:8]}-{len(rows)+1:03d}"
            rows.append(
                {
                    "acao": "I",
                    "produto": order["sku"],
                    "quantidade": order["qty"],
                    "data_inicio": order["start"].replace("-", ""),
                    "data_fim": order["end"].replace("-", ""),
                    "maquina": order["machine"],
                    "observacao": f"Gerado pelo Planner v1.0 | Action: {action_id}",
                }
            )
            if action_id:
                self._log[action_id] = erp_number
            result.exported += 1

        path = self.export_dir / f"{client}_{plan_run_id}_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.csv"
        with path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["acao", "produto", "quantidade", "data_inicio", "data_fim", "maquina", "observacao"],
                delimiter=";",
            )
            writer.writeheader()
            writer.writerows(rows)
        result.path = str(path)
        return result
