"""Testes do SyncService (PostgreSQL). Pula se o banco estiver indisponível."""

from __future__ import annotations

import os
from datetime import date

import polars as pl
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from planner.core.ontology.sync_service import SyncService


def _database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://planner:planner@localhost:5432/planner"
    )


def _postgres_ready() -> bool:
    try:
        engine = create_engine(_database_url(), future=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            conn.execute(text("SELECT 1 FROM ontology.product LIMIT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _postgres_ready(),
    reason="PostgreSQL/ontology.product indisponível (rode alembic upgrade head)",
)


@pytest.fixture
def session_factory():
    engine = create_engine(_database_url(), future=True)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    yield factory
    # cleanup test SKUs
    session = factory()
    try:
        session.execute(
            text("DELETE FROM ontology.product WHERE sku LIKE 'SYNCTEST-%'")
        )
        session.execute(
            text(
                "DELETE FROM ontology.inventory_position WHERE sku LIKE 'SYNCTEST-%'"
            )
        )
        session.execute(text("DELETE FROM ontology.demand WHERE id LIKE 'SYNCTEST-%'"))
        session.commit()
    finally:
        session.close()
        engine.dispose()


@pytest.mark.integration
def test_sync_products_insert_then_update(session_factory):
    sync = SyncService(session_factory=session_factory)
    df1 = pl.DataFrame(
        {
            "sku": [f"SYNCTEST-{i}" for i in range(1, 6)],
            "description": [f"Produto {i}" for i in range(1, 6)],
            "family": ["FIX"] * 5,
            "unit": ["kg"] * 5,
            "min_stock": [1.0, 2.0, 3.0, 4.0, 5.0],
            "active": [True] * 5,
        }
    )
    r1 = sync.sync_products("nicoletti", df1, source_ref="test:1")
    assert r1.inserted == 5
    assert r1.updated == 0
    assert not r1.errors

    df2 = df1.with_columns(
        pl.when(pl.col("sku").is_in(["SYNCTEST-1", "SYNCTEST-2"]))
        .then(pl.lit("Produto alterado"))
        .otherwise(pl.col("description"))
        .alias("description")
    )
    r2 = sync.sync_products("nicoletti", df2, source_ref="test:2")
    assert r2.updated == 2
    assert r2.ignored == 3
    assert r2.inserted == 0

    obj = sync.get_object("Product", "SYNCTEST-1")
    assert obj is not None
    assert obj.description == "Produto alterado"
    assert obj.source_ref == "test:2"


@pytest.mark.integration
def test_sync_inventory_snapshot(session_factory):
    sync = SyncService(session_factory=session_factory)
    df = pl.DataFrame({"sku": ["SYNCTEST-INV"], "available": [10.0], "blocked": [1.0]})
    today = date.today()
    r1 = sync.sync_inventory("nicoletti", df, today, source_ref="inv:1")
    assert r1.inserted == 1
    obj = sync.get_object("InventoryPosition", ("SYNCTEST-INV", today))
    assert obj is not None
    assert obj.available == 10.0
