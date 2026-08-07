"""Testes leves do comando plan (dry-run) e healthcheck."""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from planner.core.monitoring.alerts import send_alert
from planner.core.monitoring.health import HealthService


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.unit
def test_send_alert_returns_payload():
    alert = send_alert("WARNING", "forecast", "WMAPE alto", "nicoletti")
    assert alert["level"] == "WARNING"
    assert alert["client"] == "nicoletti"
    assert "timestamp" in alert


@pytest.mark.unit
def test_health_disk_check():
    service = HealthService(data_root=str(ROOT))
    with patch.object(service, "_check_postgres", return_value={"status": "ok", "latency_ms": 1}):
        with patch.object(
            service,
            "_check_last_pipeline",
            return_value={"status": "ok", "hours_since_last_run": 1},
        ):
            status = service.check()
    assert status.status == "healthy"
    assert status.checks["disk"]["status"] == "ok"
    assert "free_percent" in status.checks["disk"]


@pytest.mark.unit
def test_plan_dry_run_with_fixture_csv(tmp_path: Path):
    from planner.core.engine.plan_pipeline import run_plan

    client = "nicoletti"
    data_root = tmp_path / "data"
    csv_dir = data_root / client / "csv"
    csv_dir.mkdir(parents=True)
    src = ROOT / "fixtures" / "nicoletti" / "produtos.csv"
    shutil.copy(src, csv_dir / "products.csv")

    # config canônica na raiz do repo
    config_root = ROOT / "config"
    if not (config_root / client).exists():
        config_root = ROOT / "planner" / "config"

    summary = run_plan(
        client,
        config_root=config_root,
        data_root=data_root,
        horizon_days=14,
        dry_run=True,
        session_factory=MagicMock(),  # não deve tocar o banco em dry-run
    )
    assert summary.dry_run is True
    assert summary.plan_run_id
    assert summary.solver_status
    assert not summary.errors
