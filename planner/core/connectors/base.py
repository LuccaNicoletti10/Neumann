"""Contrato abstrato de conectores — só extrai, não transforma."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

import polars as pl


class Connector(ABC):
    """
    Extrai dados de uma fonte e entrega DataFrames Polars.

    Não transforma, não renomeia, não limpa. Só extrai.
    """

    name: str

    @abstractmethod
    def extract(self, dataset: str, since: datetime | None = None) -> pl.DataFrame:
        """
        Extrai um dataset bruto da fonte.

        dataset: 'products' | 'sales' | 'inventory' | 'orders' | 'machines' | 'bom' | 'routings'
        Retorna DataFrame Polars com os dados brutos da fonte.
        """

    @abstractmethod
    def healthcheck(self) -> bool:
        """Verifica se a fonte está acessível."""

    @abstractmethod
    def list_datasets(self) -> list[str]:
        """Lista os datasets disponíveis nesta fonte."""
