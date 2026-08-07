"""Healthcheck do planner — Postgres, último plan_run e disco."""

from __future__ import annotations

import logging
import shutil
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from planner.core.db import get_session_factory

logger = logging.getLogger(__name__)


@dataclass
class HealthStatus:
    """Resultado agregado do healthcheck."""

    status: str  # healthy | degraded
    checks: dict[str, Any]

    @property
    def ok(self) -> bool:
        return self.status == "healthy"


class HealthService:
    """Monta o payload de GET /health."""

    def __init__(
        self,
        data_root: str = "./data",
        session_factory: sessionmaker | None = None,
    ) -> None:
        self.data_root = data_root
        self._session_factory = session_factory
        self.last_pipeline_ok_at: datetime | None = None

    def check(self) -> HealthStatus:
        checks = {
            "postgres": self._check_postgres(),
            "last_pipeline": self._check_last_pipeline(),
            "disk": self._check_disk(),
        }
        degraded = any(c.get("status") != "ok" for c in checks.values())
        status = "degraded" if degraded else "healthy"
        return HealthStatus(status=status, checks=checks)

    def _session_factory_resolved(self) -> sessionmaker:
        return self._session_factory or get_session_factory()

    def _check_postgres(self) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            session = self._session_factory_resolved()()
            try:
                session.execute(text("SELECT 1"))
                session.commit()
            finally:
                session.close()
            latency_ms = round((time.perf_counter() - started) * 1000, 1)
            return {"status": "ok", "latency_ms": latency_ms}
        except Exception as exc:
            logger.error("Health postgres falhou: %s", exc)
            latency_ms = round((time.perf_counter() - started) * 1000, 1)
            return {"status": "error", "latency_ms": latency_ms, "error": str(exc)}

    def _check_last_pipeline(self) -> dict[str, Any]:
        try:
            session = self._session_factory_resolved()()
            try:
                row = session.execute(
                    text(
                        """
                        SELECT MAX(created_at) AS last_run
                        FROM decisions.plan_run
                        """
                    )
                ).mappings().first()
            finally:
                session.close()
            last_run = row["last_run"] if row else None
            if last_run is None and self.last_pipeline_ok_at is not None:
                last_run = self.last_pipeline_ok_at
            if last_run is None:
                return {
                    "status": "warning",
                    "hours_since_last_run": None,
                    "detail": "nenhum plan_run encontrado",
                }
            if last_run.tzinfo is None:
                last_run = last_run.replace(tzinfo=timezone.utc)
            hours = (datetime.now(timezone.utc) - last_run).total_seconds() / 3600
            status = "ok" if hours <= 24 else "error"
            return {"status": status, "hours_since_last_run": round(hours, 2)}
        except Exception as exc:
            logger.error("Health last_pipeline falhou: %s", exc)
            return {"status": "error", "hours_since_last_run": None, "error": str(exc)}

    def _check_disk(self) -> dict[str, Any]:
        root = Path(self.data_root)
        target = root if root.exists() else Path("/")
        usage = shutil.disk_usage(str(target))
        free_percent = round(100.0 * usage.free / usage.total, 1) if usage.total else 0.0
        status = "ok" if free_percent >= 10 else "error"
        return {"status": status, "free_percent": free_percent}
