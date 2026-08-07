"""Validação de datasets clean via Pandera."""

from __future__ import annotations

import polars as pl

from .schemas import ProductSchema, SalesSchema, validate_dataframe

SCHEMA_BY_DATASET = {
    "products": ProductSchema,
    "clean.products": ProductSchema,
    "sales": SalesSchema,
    "clean.sales": SalesSchema,
}


def validate_clean_dataset(dataset: str, df: pl.DataFrame) -> pl.DataFrame:
    schema = SCHEMA_BY_DATASET.get(dataset)
    if schema is None:
        return df
    return validate_dataframe(df, schema)
