"""Revision ID: 005
Revises: 004
Create Date: 2026-08-07

Forecast metadados + FK decision_log → plan_line.
"""

from __future__ import annotations

from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE decisions.forecast
            ADD COLUMN IF NOT EXISTS forecast_run_id VARCHAR(64),
            ADD COLUMN IF NOT EXISTS bias_backtest DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS profile VARCHAR(32),
            ADD COLUMN IF NOT EXISTS horizon_days INT,
            ADD COLUMN IF NOT EXISTS training_rows INT,
            ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'approved'
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_forecast_run "
        "ON decisions.forecast (forecast_run_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_forecast_client_run "
        "ON decisions.forecast (client_id, forecast_run_id)"
    )
    # FK decision_log.plan_line_id → plan_line.id (quando plan_line existir)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_decision_log_plan_line'
            ) THEN
                ALTER TABLE decisions.decision_log
                    ADD CONSTRAINT fk_decision_log_plan_line
                    FOREIGN KEY (plan_line_id)
                    REFERENCES decisions.plan_line (id)
                    ON DELETE CASCADE;
            END IF;
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'FK decision_log→plan_line não aplicada: %', SQLERRM;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE decisions.decision_log
            DROP CONSTRAINT IF EXISTS fk_decision_log_plan_line
        """
    )
    for col in (
        "forecast_run_id",
        "bias_backtest",
        "profile",
        "horizon_days",
        "training_rows",
        "status",
    ):
        op.execute(f"ALTER TABLE decisions.forecast DROP COLUMN IF EXISTS {col}")
