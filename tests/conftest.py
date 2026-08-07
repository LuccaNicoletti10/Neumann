"""Fixtures compartilhadas."""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def sample_products_csv(tmp_path: Path) -> Path:
    src = ROOT / "tests" / "fixtures" / "sample_products.csv"
    if not src.exists():
        src = ROOT / "fixtures" / "nicoletti" / "produtos.csv"
    dest = tmp_path / "products.csv"
    dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return dest


@pytest.fixture
def products_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "sku": ["A", "B"],
            "lead_time_days": [10, 12],
            "min_lot": [100.0, 50.0],
            "lot_multiple": [50.0, 25.0],
        }
    )
