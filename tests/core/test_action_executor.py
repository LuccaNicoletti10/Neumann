"""Testes do ActionExecutor com audit (PostgreSQL ou mocks)."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from planner.core.actions.executor import ActionExecutor
from planner.core.actions import registry as action_registry


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

    action = action_registry.ACTIONS["approve_plan_line"]
    original_vals = list(action.validations)
    original_effects = list(action.effects)
    action.validations = [lambda p: (bool(p.get("plan_line_id")), "plan_line_id obrigatório")]
    action.effects = [
        lambda p, actor: {"status": "approved", "actor": actor, "plan_line_id": p["plan_line_id"]}
    ]
    try:
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
    finally:
        action.validations = original_vals
        action.effects = original_effects

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

    missing = executor.execute(
        "approve_plan_line",
        {"plan_line_id": "PL-MISSING-XYZ", "approver": "tester", "actor_role": "approver"},
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
    assert missing.success is False
    assert bad.success is False

    rows = executor.get_audit_log("nicoletti", limit=50)
    ids = {r["id"] for r in rows}
    assert missing.audit_id in ids
    assert bad.audit_id in ids

    session = factory()
    try:
        session.execute(
            text("DELETE FROM audit.action_log WHERE id = :a OR id = :b"),
            {"a": missing.audit_id, "b": bad.audit_id},
        )
        session.commit()
    finally:
        session.close()
        engine.dispose()
