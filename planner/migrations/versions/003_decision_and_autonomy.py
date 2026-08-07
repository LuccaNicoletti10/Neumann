"""Revision ID: 003
Revises: 002
Create Date: 2026-08-07

decision_log + autonomy_log para aprendizado e autonomia limitada.
"""

from __future__ import annotations

from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS decisions.decision_log (
            id UUID PRIMARY KEY,
            client VARCHAR(64) NOT NULL,
            family VARCHAR(64),
            plan_run_id UUID NOT NULL,
            plan_line_id VARCHAR(64) NOT NULL,
            recommended_qty DOUBLE PRECISION NOT NULL,
            recommended_machine VARCHAR(64),
            final_qty DOUBLE PRECISION,
            final_machine VARCHAR(64),
            action_taken VARCHAR(32),
            reason_code VARCHAR(64),
            comment TEXT,
            actor VARCHAR(128),
            actor_type VARCHAR(16),
            actual_qty DOUBLE PRECISION,
            actual_scrap DOUBLE PRECISION,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            decided_at TIMESTAMPTZ,
            UNIQUE (plan_line_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_decision_log_client_family_action "
        "ON decisions.decision_log (client, family, action_taken)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_decision_log_created_at "
        "ON decisions.decision_log (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_decision_log_plan_run "
        "ON decisions.decision_log (plan_run_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit.autonomy_log (
            id SERIAL PRIMARY KEY,
            client VARCHAR(64) NOT NULL,
            family VARCHAR(64),
            plan_line_id VARCHAR(64),
            allowed BOOLEAN NOT NULL,
            approval_rate DOUBLE PRECISION,
            reason TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_autonomy_log_client_family "
        "ON audit.autonomy_log (client, family, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit.autonomy_log")
    op.execute("DROP TABLE IF EXISTS decisions.decision_log")
