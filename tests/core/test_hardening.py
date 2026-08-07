"""Testes de DecisionLog, WriteBack, Autonomy e Narrator (Postgres)."""

from __future__ import annotations

import os
from datetime import date, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import polars as pl
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from planner.core.ai.narrator import PlanNarrator
from planner.core.engine.autonomy import AutonomyService
from planner.core.engine.decision_log import DecisionLogService
from planner.core.engine.explain import PlanExplanation, Reason
from planner.core.engine.plan_pipeline import (
    build_calendar_from_machines,
    compatibility_to_polars,
)
from planner.core.engine.scheduler import Schedule
from planner.plugins.totvs_protheus.write_back import TotvsWriteBack


def _database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://planner:planner@localhost:5432/planner"
    )


def _postgres_ready() -> bool:
    try:
        engine = create_engine(_database_url(), future=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1 FROM decisions.decision_log LIMIT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


requires_pg = pytest.mark.skipif(
    not _postgres_ready(),
    reason="PostgreSQL/decision_log indisponível (alembic upgrade head)",
)


@pytest.fixture
def session_factory():
    engine = create_engine(_database_url(), future=True)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    yield factory
    session = factory()
    try:
        session.execute(text("DELETE FROM decisions.decision_log WHERE client = 'test_metrics'"))
        session.execute(text("DELETE FROM audit.autonomy_log WHERE client = 'test_metrics'"))
        session.execute(text("DELETE FROM audit.write_back_log WHERE action_id LIKE 'WB-TEST-%'"))
        session.execute(text("DELETE FROM audit.llm_log WHERE prompt LIKE '%test_narrator%'"))
        session.commit()
    finally:
        session.close()
        engine.dispose()


@pytest.mark.integration
@requires_pg
def test_decision_log_metrics_approval_rate(session_factory):
    svc = DecisionLogService(session_factory=session_factory)
    plan_run = uuid4()
    for i in range(10):
        line = f"PL-MET-{i}"
        svc.record_recommendation(
            plan_run,
            line,
            recommended_qty=10.0 + i,
            recommended_machine="M01",
            client="test_metrics",
            family="CLA",
        )
        action = "approved" if i < 9 else "modified"
        svc.record_decision(
            line,
            action_taken=action,
            actor="tester",
            actor_type="human",
            reason_code="ok" if action == "approved" else "adjust_qty",
            final_qty=10.0 + i,
        )
    metrics = svc.get_learning_metrics(client="test_metrics", family="CLA", weeks=4)
    assert metrics.total_lines == 10
    assert metrics.approval_rate == pytest.approx(0.9)


@pytest.mark.integration
@requires_pg
def test_write_back_idempotent(session_factory, tmp_path):
    wb = TotvsWriteBack(tmp_path, session_factory=session_factory)
    plan_run = uuid4()
    orders = [
        {
            "action_id": "WB-TEST-1",
            "sku": "SKU001",
            "qty": 10,
            "start": "2026-08-01",
            "end": "2026-08-02",
            "machine": "M01",
        },
        {
            "action_id": "WB-TEST-2",
            "sku": "SKU002",
            "qty": 20,
            "start": "2026-08-01",
            "end": "2026-08-03",
            "machine": "M02",
        },
    ]
    r1 = wb.export_approved_orders("test_metrics", plan_run, orders)
    assert r1.exported == 2
    assert r1.skipped == 0
    assert r1.path is not None
    from pathlib import Path

    assert Path(r1.path).exists()
    content = Path(r1.path).read_text(encoding="latin-1")
    assert ";" in content

    r2 = wb.export_approved_orders("test_metrics", plan_run, orders)
    assert r2.exported == 0
    assert r2.skipped == 2


@pytest.mark.integration
@requires_pg
def test_autonomy_90_vs_70(session_factory):
    svc = DecisionLogService(session_factory=session_factory)
    plan_run = uuid4()

    # família CLA: 9/10 approved = 90%
    for i in range(10):
        line = f"PL-AUTO-CLA-{i}"
        svc.record_recommendation(
            plan_run, line, 5.0, "M01", client="test_metrics", family="CLA"
        )
        svc.record_decision(
            line,
            "approved" if i < 9 else "rejected",
            actor="t",
            actor_type="human",
            reason_code="x",
        )

    # família ESC: 7/10 = 70%
    for i in range(10):
        line = f"PL-AUTO-ESC-{i}"
        svc.record_recommendation(
            plan_run, line, 5.0, "M01", client="test_metrics", family="ESC"
        )
        svc.record_decision(
            line,
            "approved" if i < 7 else "rejected",
            actor="t",
            actor_type="human",
            reason_code="y",
        )

    auto = AutonomyService(session_factory=session_factory, decision_log=svc)
    ok = auto.evaluate_family_eligibility("CLA", "test_metrics")
    bad = auto.evaluate_family_eligibility("ESC", "test_metrics")
    assert ok.eligible is True
    assert bad.eligible is False


@pytest.mark.unit
def test_narrator_fallback_and_mock_anthropic(session_factory=None):
    factory = MagicMock()
    session = MagicMock()
    factory.return_value = session

    explanations = [
        PlanExplanation(
            order="ORD-1",
            sku="SKU001",
            qty=10,
            machine="M01",
            window=["2026-08-01", "2026-08-02"],
            reasons=[Reason(type="stockout_risk", message="risco de ruptura")],
        )
    ]
    plan = Schedule(assignments=[], solver_status="FEASIBLE")

    # sem API key → fallback
    narrator = PlanNarrator(api_key=None, session_factory=factory)
    text = narrator.narrate_plan(plan, explanations, "nicoletti")
    assert "Plano de produção" in text
    assert narrator.llm_log[-1]["mode"] == "fallback"

    # com mock Anthropic
    class _Block:
        text = "Narrativa mockada do plano."

    class _Usage:
        input_tokens = 10
        output_tokens = 20

    class _Resp:
        content = [_Block()]
        usage = _Usage()

    class _Messages:
        def create(self, **kwargs):
            assert kwargs["model"] == "claude-3-5-sonnet-20241022"
            return _Resp()

    class _Client:
        messages = _Messages()

    narrator2 = PlanNarrator(
        api_key="test-key",
        session_factory=factory,
        anthropic_client_factory=lambda key: _Client(),
    )
    text2 = narrator2.narrate_plan(plan, explanations, "test_narrator")
    assert "Narrativa mockada" in text2
    assert narrator2.llm_log[-1]["mode"] == "anthropic"


@pytest.mark.unit
def test_calendar_from_machines():
    machines = pl.DataFrame(
        {
            "id": ["M01"],
            "work_center_id": ["WC1"],
            "name": ["Tear"],
            "hours_per_day": [8.0],
            "shifts": [2],
            "efficiency": [0.9],
        }
    )
    cal = build_calendar_from_machines(machines, date.today(), 2, {"M01": 2.0})
    assert cal.height == 3
    assert cal.filter(pl.col("date") == date.today())["available_hours"][0] == pytest.approx(12.4)


@pytest.mark.unit
def test_compatibility_to_polars_empty():
    df = compatibility_to_polars([])
    assert df.is_empty()
    assert "sku" in df.columns
