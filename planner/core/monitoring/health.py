"""Monitoramento e alertas básicos."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class HealthStatus:
    ok: bool
    checks: dict[str, Any]


class HealthService:
    def __init__(self, data_root: str = "./data") -> None:
        self.data_root = data_root
        self.last_pipeline_ok_at: datetime | None = None

    def check(self, postgres_ok: bool = True) -> HealthStatus:
        disk = shutil.disk_usage(self.data_root if self.data_root else ".")
        free_pct = disk.free / disk.total if disk.total else 0
        pipeline_ok = True
        if self.last_pipeline_ok_at:
            age_h = (datetime.now(timezone.utc) - self.last_pipeline_ok_at).total_seconds() / 3600
            pipeline_ok = age_h <= 24
        checks = {
            "postgres": postgres_ok,
            "pipeline_24h": pipeline_ok,
            "disk_free_pct": round(free_pct * 100, 1),
        }
        ok = postgres_ok and pipeline_ok and free_pct > 0.10
        return HealthStatus(ok=ok, checks=checks)


class AlertService:
    def __init__(self) -> None:
        self.alerts: list[dict[str, Any]] = []

    def emit(self, level: str, component: str, message: str, client: str) -> dict[str, Any]:
        alert = {
            "level": level,
            "component": component,
            "message": message,
            "client": client,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        self.alerts.append(alert)
        return alert
