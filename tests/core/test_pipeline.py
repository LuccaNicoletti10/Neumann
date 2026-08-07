"""Testes de pipeline RAW e netting."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import polars as pl
import pytest

from planner.core.engine.netting import calculate_net_requirements
from planner.core.pipeline.raw import RawLayer
from planner.core.pipeline.schema_map import SchemaMapLoader, apply_schema_map


@pytest.mark.unit
def test_raw_append_only(tmp_path: Path):
    raw = RawLayer(tmp_path)
    df = pl.DataFrame({"sku": ["A"], "qty": [1]})
    raw.write_dataset("c1", "products", df, run_id="1")
    raw.write_dataset("c1", "products", df, run_id="2")
    with pytest.raises(FileExistsError):
        raw.write_dataset("c1", "products", df, run_id="1")
    versions = raw.list_versions("c1", "products")
    assert len(versions) == 2
    latest = raw.read_dataset("c1", "products")
    assert latest.height == 1


@pytest.mark.unit
def test_schema_map_products():
    root = Path(__file__).resolve().parents[2]
    mapping = SchemaMapLoader().load_file(root / "config" / "nicoletti" / "mappings" / "products.yaml")
    df = pl.read_csv(root / "fixtures" / "nicoletti" / "produtos.csv")
    # remove invalid unit row for clean map test
    df = df.filter(pl.col("B1_UM") != "KGS?")
    out = apply_schema_map(df, mapping)
    assert "sku" in out.columns
    assert out.filter(pl.col("sku") == "PROD001")["unit"][0] == "kg"


@pytest.mark.unit
def test_netting_cover_scenarios(products_df: pl.DataFrame):
    forecasts = pl.DataFrame({"sku": ["A", "B"], "qty": [300.0, 300.0]})
    # A: estoque alto → net 0; B: estoque baixo → net > 0
    inventory = pl.DataFrame({"sku": ["A", "B"], "available": [10000.0, 50.0]})
    open_orders = pl.DataFrame({"sku": [], "qty": []}).cast({"sku": pl.Utf8, "qty": pl.Float64})
    open_production = pl.DataFrame(
        {"sku": [], "qty_planned": [], "qty_produced": []}
    ).cast({"sku": pl.Utf8, "qty_planned": pl.Float64, "qty_produced": pl.Float64})
    bom = pl.DataFrame({"parent_sku": [], "component_sku": [], "qty_per_unit": []}).cast(
        {"parent_sku": pl.Utf8, "component_sku": pl.Utf8, "qty_per_unit": pl.Float64}
    )
    results = {
        r.sku: r
        for r in calculate_net_requirements(
            forecasts,
            inventory,
            open_orders,
            open_production,
            products_df,
            bom,
            {"min_days_of_cover": 12, "service_level_z": 1.645},
            today=date.today(),
        )
    }
    assert results["A"].suggested_qty == 0
    assert results["B"].suggested_qty > 0
