"""Testes do ActionExecutor com audit (PostgreSQL ou memória de fallback)."""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from planner.core.actions.executor import ActionExecutor


def _database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://planner:planner@localhost:5432/planner"
    )


def _postgres_ready() -> bool:
    try:
        engine = create_engine(_database_url(), future=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1 FROM audit.action_log LIMIT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


@pytest.mark.unit
def test_approve_plan_line_valid_and_invalid_with_mock_session():
    """Ambos (válido e inválido) entram no audit — mesmo se o INSERT DB falhar."""
    session = MagicMock()
    factory = MagicMock(return_value=session)

    executor = ActionExecutor(session_factory=factory)

    ok = executor.execute(
        "approve_plan_line",
        {"plan_line_id": "PL-1", "approver": "lucca", "client": "nicoletti"},
        actor="lucca",
        actor_type="human",
        client="nicoletti",
    )
    bad = executor.execute(
        "approve_plan_line",
        {"approver": "lucca", "client": "nicoletti"},
        actor="lucca",
        actor_type="human",
        client="nicoletti",
    )

    assert ok.success is True
    assert bad.success is False
    assert bad.error
    assert len(executor.audit_log) == 2
    assert executor.audit_log[0]["success"] is True
    assert executor.audit_log[1]["success"] is False
    assert session.add.call_count == 2
    assert session.commit.call_count == 2


@pytest.mark.integration
@pytest.mark.skipif(not _postgres_ready(), reason="PostgreSQL/audit.action_log indisponível")
def test_approve_persists_to_postgres():
    engine = create_engine(_database_url(), future=True)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    executor = ActionExecutor(session_factory=factory)

    ok = executor.execute(
        "approve_plan_line",
        {"plan_line_id": "PL-TEST-OK", "approver": "tester", "client": "nicoletti"},
        actor="tester",
        actor_type="human",
        client="nicoletti",
    )
    bad = executor.execute(
        "approve_plan_line",
        {"client": "nicoletti"},
        actor="tester",
        actor_type="human",
        client="nicoletti",
    )
    assert ok.success and not bad.success

    rows = executor.get_audit_log("nicoletti", limit=50)
    ids = {r["id"] for r in rows}
    assert ok.audit_id in ids
    assert bad.audit_id in ids

    session = factory()
    try:
        session.execute(
            text("DELETE FROM audit.action_log WHERE id = :a OR id = :b"),
            {"a": ok.audit_id, "b": bad.audit_id},
        )
        session.commit()
    finally:
        session.close()
        engine.dispose()
