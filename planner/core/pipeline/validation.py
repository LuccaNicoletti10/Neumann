"""Validação de datasets clean via Pandera."""

from __future__ import annotations

import polars as pl

from .schemas import SCHEMA_BY_OUTPUT, validate_dataframe


def validate_clean_dataset(dataset: str, df: pl.DataFrame) -> pl.DataFrame:
    """Valida dataset clean; desconhecido passa sem schema (ainda tipado pelo transform)."""
    key = dataset if dataset.startswith("clean.") else f"clean.{dataset}"
    schema = SCHEMA_BY_OUTPUT.get(key) or SCHEMA_BY_OUTPUT.get(dataset)
    if schema is None:
        return df
    return validate_dataframe(df, schema)
