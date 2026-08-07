"""Conector CSV genérico — lê arquivos de uma pasta configurada."""

from __future__ import annotations

import logging
import time
from datetime import datetime
from pathlib import Path

import polars as pl

from planner.core.connectors.base import Connector

logger = logging.getLogger(__name__)


class CsvGenericConnector(Connector):
    """
    Lê CSVs de uma pasta. Cada dataset = um arquivo (products.csv, sales.csv, ...).

    Suporta UTF-8 e Latin-1, detecta delimitador automaticamente.
    """

    name = "csv_generic"

    def __init__(self, base_path: str | Path, encoding: str = "auto") -> None:
        self.base_path = Path(base_path)
        self.encoding = encoding

    def list_datasets(self) -> list[str]:
        if not self.base_path.exists():
            return []
        return sorted(p.stem for p in self.base_path.glob("*.csv"))

    def healthcheck(self) -> bool:
        return self.base_path.exists() and any(self.base_path.glob("*.csv"))

    def extract(self, dataset: str, since: datetime | None = None) -> pl.DataFrame:
        path = self.base_path / f"{dataset}.csv"
        if not path.exists():
            # aceita também produtos.csv estilo legado via alias
            raise FileNotFoundError(f"Arquivo CSV não encontrado: {path}")

        started = time.perf_counter()
        df = self._read_csv(path)
        duration = time.perf_counter() - started
        logger.info(
            "CSV lido dataset=%s path=%s rows=%s duration=%.3fs",
            dataset,
            path,
            df.height,
            duration,
        )
        return df

    def _read_csv(self, path: Path) -> pl.DataFrame:
        encodings = (
            ["utf8", "latin1"] if self.encoding == "auto" else [self.encoding]
        )
        delimiters = [",", ";", "\t"]
        last_error: Exception | None = None

        for enc in encodings:
            for sep in delimiters:
                try:
                    df = pl.read_csv(
                        path,
                        separator=sep,
                        encoding=enc,
                        infer_schema_length=1000,
                        ignore_errors=False,
                    )
                    if df.width >= 1:
                        return df
                except Exception as exc:  # noqa: BLE001 — tenta próximo encoding/sep
                    last_error = exc
                    continue

        raise ValueError(
            f"Não foi possível ler {path} (encoding/delimitador inválidos): {last_error}"
        )
