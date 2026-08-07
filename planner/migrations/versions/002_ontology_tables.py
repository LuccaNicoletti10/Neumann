"""Revision ID: 002
Revises: 001
Create Date: 2026-08-07

Concrete manufacturing ontology tables in schema `ontology`.
props JSONB holds client-extensible attributes without a new migration.
No cross-schema FKs (raw_meta / ontology / decisions / audit stay independent).
"""

from __future__ import annotations

from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS ontology")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.product (
            sku VARCHAR(64) PRIMARY KEY,
            description TEXT,
            family VARCHAR(64),
            unit VARCHAR(16),
            min_stock DOUBLE PRECISION,
            max_stock DOUBLE PRECISION,
            min_lot DOUBLE PRECISION,
            lot_multiple DOUBLE PRECISION,
            lead_time_days INT,
            cost DOUBLE PRECISION,
            active BOOLEAN DEFAULT true,
            props JSONB DEFAULT '{}',
            source_ref VARCHAR(128),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_product_family ON ontology.product (family)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.machine (
            id VARCHAR(64) PRIMARY KEY,
            work_center_id VARCHAR(64) NOT NULL,
            name VARCHAR(128),
            hours_per_day DOUBLE PRECISION,
            shifts INT,
            efficiency DOUBLE PRECISION,
            props JSONB DEFAULT '{}',
            source_ref VARCHAR(128)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_machine_work_center_id "
        "ON ontology.machine (work_center_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.inventory_position (
            sku VARCHAR(64) NOT NULL,
            snapshot_date DATE NOT NULL,
            available DOUBLE PRECISION,
            blocked DOUBLE PRECISION,
            in_qc DOUBLE PRECISION,
            reserved DOUBLE PRECISION,
            in_process DOUBLE PRECISION,
            location VARCHAR(64),
            source_ref VARCHAR(128),
            PRIMARY KEY (sku, snapshot_date)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_inventory_position_sku "
        "ON ontology.inventory_position (sku)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_inventory_position_snapshot_date "
        "ON ontology.inventory_position (snapshot_date)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.demand (
            id VARCHAR(64) PRIMARY KEY,
            sku VARCHAR(64) NOT NULL,
            date DATE,
            qty DOUBLE PRECISION,
            type VARCHAR(32),
            customer VARCHAR(128),
            price DOUBLE PRECISION,
            source_ref VARCHAR(128)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_demand_sku ON ontology.demand (sku)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_demand_date ON ontology.demand (date)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.production_order (
            id VARCHAR(64) PRIMARY KEY,
            sku VARCHAR(64) NOT NULL,
            machine_id VARCHAR(64),
            qty_planned DOUBLE PRECISION,
            qty_produced DOUBLE PRECISION,
            start_planned TIMESTAMPTZ,
            end_planned TIMESTAMPTZ,
            start_actual TIMESTAMPTZ,
            end_actual TIMESTAMPTZ,
            status VARCHAR(32),
            scrap DOUBLE PRECISION,
            rework DOUBLE PRECISION,
            source_ref VARCHAR(128)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_production_order_sku "
        "ON ontology.production_order (sku)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_production_order_machine_id "
        "ON ontology.production_order (machine_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.bom (
            parent_sku VARCHAR(64) NOT NULL,
            component_sku VARCHAR(64) NOT NULL,
            qty_per_unit DOUBLE PRECISION,
            PRIMARY KEY (parent_sku, component_sku)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_bom_parent_sku ON ontology.bom (parent_sku)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_bom_component_sku "
        "ON ontology.bom (component_sku)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.routing (
            sku VARCHAR(64) NOT NULL,
            step INT NOT NULL,
            work_center_id VARCHAR(64),
            minutes_per_unit DOUBLE PRECISION,
            PRIMARY KEY (sku, step)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_routing_sku ON ontology.routing (sku)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_routing_work_center_id "
        "ON ontology.routing (work_center_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.compatibility (
            sku VARCHAR(64) NOT NULL,
            machine_id VARCHAR(64) NOT NULL,
            speed_units_per_hour DOUBLE PRECISION,
            PRIMARY KEY (sku, machine_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_compatibility_sku "
        "ON ontology.compatibility (sku)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_compatibility_machine_id "
        "ON ontology.compatibility (machine_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ontology.setup_matrix (
            machine_id VARCHAR(64) NOT NULL,
            from_family VARCHAR(64) NOT NULL,
            to_family VARCHAR(64) NOT NULL,
            setup_minutes DOUBLE PRECISION,
            forbidden BOOLEAN DEFAULT false,
            PRIMARY KEY (machine_id, from_family, to_family)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_setup_matrix_machine_id "
        "ON ontology.setup_matrix (machine_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_setup_matrix_from_family "
        "ON ontology.setup_matrix (from_family)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ontology_setup_matrix_to_family "
        "ON ontology.setup_matrix (to_family)"
    )


def downgrade() -> None:
    # Reverse creation order; no FKs within ontology, so drops are independent.
    op.execute("DROP TABLE IF EXISTS ontology.setup_matrix")
    op.execute("DROP TABLE IF EXISTS ontology.compatibility")
    op.execute("DROP TABLE IF EXISTS ontology.routing")
    op.execute("DROP TABLE IF EXISTS ontology.bom")
    op.execute("DROP TABLE IF EXISTS ontology.production_order")
    op.execute("DROP TABLE IF EXISTS ontology.demand")
    op.execute("DROP TABLE IF EXISTS ontology.inventory_position")
    op.execute("DROP TABLE IF EXISTS ontology.machine")
    op.execute("DROP TABLE IF EXISTS ontology.product")
