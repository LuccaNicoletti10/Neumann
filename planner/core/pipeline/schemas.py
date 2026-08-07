"""Schemas Pandera (Polars) — validação contínua antes da ontologia."""

from __future__ import annotations

import pandera.polars as pa
import polars as pl
from pandera.engines.polars_engine import DateTime


class ProductSchema(pa.DataFrameModel):
    sku: str = pa.Field(nullable=False, unique=True)
    description: str = pa.Field(nullable=True)
    unit: str = pa.Field(isin=["kg", "m", "unit", "un", "pc"])
    min_stock: float = pa.Field(nullable=True, ge=0)
    min_lot: float = pa.Field(nullable=True, ge=0)
    active: bool = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class SalesSchema(pa.DataFrameModel):
    sku: str = pa.Field(nullable=False)
    date: DateTime = pa.Field(nullable=False)
    qty: float = pa.Field(nullable=False, gt=0)
    customer: str = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


def validate_dataframe(df: pl.DataFrame, schema: type[pa.DataFrameModel]) -> pl.DataFrame:
    """Valida e retorna o DataFrame; falha = pipeline PARA."""
    return schema.validate(df, lazy=True)
