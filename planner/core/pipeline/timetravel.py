"""Time-travel e lineage sobre a camada RAW/clean."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import polars as pl
from rich.console import Console
from rich.table import Table

from .raw import RawLayer


def timetravel_read(
    data_root: str | Path,
    client: str,
    dataset: str,
    on_date: date,
) -> pl.DataFrame:
    """
    Lê a versão mais recente de um dataset na data informada.

    dataset: 'raw.products' | 'clean.sales' | 'products'
    """
    data_root = Path(data_root)
    layer, name = _split_dataset(dataset)
    if layer == "raw":
        raw = RawLayer(data_root)
        return raw.read_dataset(client, name, snapshot_date=on_date)

    root = data_root / client / "clean" / name / f"snapshot_date={on_date.isoformat()}"
    files = sorted(root.glob("run_*.parquet"))
    if not files:
        raise FileNotFoundError(f"Sem versão clean em {on_date} para {name}")
    return pl.read_parquet(files[-1])


def print_timetravel(
    data_root: str | Path,
    client: str,
    dataset: str,
    on_date: date,
    limit: int = 20,
) -> None:
    df = timetravel_read(data_root, client, dataset, on_date)
    console = Console()
    table = Table(title=f"{dataset} @ {on_date.isoformat()} ({df.height} rows)")
    preview = df.head(limit)
    for col in preview.columns:
        table.add_column(col)
    for row in preview.iter_rows():
        table.add_row(*[str(v) if v is not None else "" for v in row])
    console.print(table)


def show_lineage(data_root: str | Path, client: str, dataset: str, version: str) -> list[dict]:
    lineage_path = Path(data_root) / client / "clean" / "_lineage.jsonl"
    if not lineage_path.exists():
        return []
    rows = []
    for line in lineage_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        import json

        item = json.loads(line)
        if item.get("derived_table") == dataset and (
            version in str(item.get("derived_version", ""))
            or version in str(item.get("created_at", ""))
        ):
            rows.append(item)
    return rows


def _split_dataset(dataset: str) -> tuple[str, str]:
    if "." in dataset:
        layer, name = dataset.split(".", 1)
        return layer, name
    return "raw", dataset
