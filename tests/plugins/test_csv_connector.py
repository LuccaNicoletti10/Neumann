"""Testes do conector CSV."""

from __future__ import annotations

from pathlib import Path

import pytest

from planner.plugins.csv_generic import CsvGenericConnector


@pytest.mark.unit
def test_csv_connector_extract(sample_products_csv: Path):
    connector = CsvGenericConnector(sample_products_csv.parent)
    assert connector.healthcheck()
    assert "products" in connector.list_datasets()
    df = connector.extract("products")
    assert df.height >= 1
    assert "B1_COD" in df.columns
