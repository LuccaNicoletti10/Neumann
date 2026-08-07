"""Revision ID: 001
Revises:
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS raw_meta")
    op.execute("CREATE SCHEMA IF NOT EXISTS ontology")
    op.execute("CREATE SCHEMA IF NOT EXISTS decisions")
    op.execute("CREATE SCHEMA IF NOT EXISTS audit")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS raw_meta.dataset_versions (
            id SERIAL PRIMARY KEY,
            client VARCHAR(64) NOT NULL,
            dataset VARCHAR(64) NOT NULL,
            snapshot_date DATE NOT NULL,
            run_id VARCHAR(32) NOT NULL,
            path TEXT NOT NULL,
            rows INTEGER,
            checksum VARCHAR(64),
            connector VARCHAR(64),
            extracted_at TIMESTAMPTZ,
            status VARCHAR(16) DEFAULT 'success',
            UNIQUE(client, dataset, snapshot_date, run_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS raw_meta.lineage (
            id SERIAL PRIMARY KEY,
            derived_table VARCHAR(64),
            derived_version VARCHAR(32),
            source_dataset VARCHAR(64),
            source_version VARCHAR(32),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS decisions.forecast (
            id SERIAL PRIMARY KEY,
            sku VARCHAR(64) NOT NULL,
            month DATE NOT NULL,
            qty DOUBLE PRECISION NOT NULL,
            model VARCHAR(64),
            wmape_backtest DOUBLE PRECISION,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS decisions.plan_run (
            id UUID PRIMARY KEY,
            client VARCHAR(64) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            input_snapshot_versions JSONB,
            solver_status VARCHAR(32),
            objective DOUBLE PRECISION,
            duration_seconds DOUBLE PRECISION
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit.action_log (
            id UUID PRIMARY KEY,
            action_type VARCHAR(64),
            params JSONB,
            actor VARCHAR(128),
            actor_type VARCHAR(16),
            timestamp TIMESTAMPTZ DEFAULT NOW(),
            validations_result JSONB,
            effects_result JSONB,
            plan_run_id UUID,
            success BOOLEAN
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit.llm_log (
            id SERIAL PRIMARY KEY,
            prompt TEXT,
            response TEXT,
            tokens INT,
            cost DOUBLE PRECISION,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit.write_back_log (
            action_id VARCHAR(64) PRIMARY KEY,
            erp_order_number VARCHAR(64),
            exported_at TIMESTAMPTZ DEFAULT NOW(),
            status VARCHAR(32)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit.write_back_log")
    op.execute("DROP TABLE IF EXISTS audit.llm_log")
    op.execute("DROP TABLE IF EXISTS audit.action_log")
    op.execute("DROP TABLE IF EXISTS decisions.plan_run")
    op.execute("DROP TABLE IF EXISTS decisions.forecast")
    op.execute("DROP TABLE IF EXISTS raw_meta.lineage")
    op.execute("DROP TABLE IF EXISTS raw_meta.dataset_versions")
