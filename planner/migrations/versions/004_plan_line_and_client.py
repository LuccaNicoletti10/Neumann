"""Revision ID: 004
Revises: 003
Create Date: 2026-08-07

plan_line + client_id nas tabelas operacionais críticas.
"""

from __future__ import annotations

from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # plan_line — persistência completa do plano
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS decisions.plan_line (
            id UUID PRIMARY KEY,
            client VARCHAR(64) NOT NULL,
            plan_run_id UUID NOT NULL,
            sku VARCHAR(64) NOT NULL,
            family VARCHAR(64),
            qty DOUBLE PRECISION NOT NULL,
            machine_id VARCHAR(64),
            start_ts TIMESTAMPTZ,
            end_ts TIMESTAMPTZ,
            setup_minutes DOUBLE PRECISION,
            priority DOUBLE PRECISION,
            deadline DATE,
            status VARCHAR(32) DEFAULT 'proposed',
            explanation JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_plan_line_client_run "
        "ON decisions.plan_line (client, plan_run_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_plan_line_status ON decisions.plan_line (status)"
    )

    # client_id nas tabelas ontology (nullable→default para legado, depois NOT NULL em novos inserts)
    for table, col in [
        ("ontology.product", "client_id"),
        ("ontology.inventory_position", "client_id"),
        ("ontology.demand", "client_id"),
        ("ontology.machine", "client_id"),
        ("ontology.production_order", "client_id"),
        ("ontology.bom", "client_id"),
        ("ontology.routing", "client_id"),
        ("ontology.compatibility", "client_id"),
        ("ontology.setup_matrix", "client_id"),
    ]:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} VARCHAR(64) DEFAULT 'default'"
        )
        op.execute(f"UPDATE {table} SET {col} = 'default' WHERE {col} IS NULL")

    op.execute(
        "ALTER TABLE decisions.forecast ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) DEFAULT 'default'"
    )
    op.execute(
        "ALTER TABLE decisions.plan_run ADD COLUMN IF NOT EXISTS engine_version VARCHAR(32)"
    )
    op.execute(
        "ALTER TABLE audit.action_log ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) DEFAULT 'default'"
    )
    op.execute(
        "ALTER TABLE audit.write_back_log ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) DEFAULT 'default'"
    )
    op.execute(
        "ALTER TABLE audit.llm_log ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) DEFAULT 'default'"
    )

    # FKs leves (mesmo schema) — só se não existirem
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE decisions.plan_line
                ADD CONSTRAINT fk_plan_line_run
                FOREIGN KEY (plan_run_id) REFERENCES decisions.plan_run(id);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS decisions.plan_line")
