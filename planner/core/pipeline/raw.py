"""Camada RAW imutável — datasets versionados em Parquet (append-only)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import polars as pl


@dataclass(frozen=True)
class DatasetVersion:
    client: str
    dataset: str
    snapshot_date: date
    run_id: str
    path: str
    rows: int
    checksum: str
    connector: str
    extracted_at: datetime
    status: str = "success"


class RawLayer:
    """
    Persistência append-only de datasets brutos.

    NUNCA delete, NUNCA sobrescreva. Cada write cria nova versão.
    """

    def __init__(self, data_root: str | Path) -> None:
        self.data_root = Path(data_root)
        self._index: list[DatasetVersion] = []

    def write_dataset(
        self,
        client: str,
        dataset: str,
        df: pl.DataFrame,
        run_id: str,
        metadata: dict[str, Any] | None = None,
        *,
        snapshot_date: date | None = None,
    ) -> str:
        metadata = metadata or {}
        snap = snapshot_date or datetime.now(timezone.utc).date()
        folder = (
            self.data_root
            / client
            / "raw"
            / dataset
            / f"snapshot_date={snap.isoformat()}"
        )
        folder.mkdir(parents=True, exist_ok=True)

        parquet_path = folder / f"run_{run_id}.parquet"
        meta_path = folder / f"run_{run_id}.meta.json"

        if parquet_path.exists():
            raise FileExistsError(f"Versão já existe (append-only): {parquet_path}")

        df.write_parquet(parquet_path, compression="zstd")
        checksum = self._sha256(parquet_path)
        extracted_at = datetime.now(timezone.utc)
        version = DatasetVersion(
            client=client,
            dataset=dataset,
            snapshot_date=snap,
            run_id=run_id,
            path=str(parquet_path),
            rows=df.height,
            checksum=checksum,
            connector=str(metadata.get("connector", "unknown")),
            extracted_at=extracted_at,
            status=str(metadata.get("status", "success")),
        )
        meta_path.write_text(
            json.dumps(asdict(version), default=str, indent=2),
            encoding="utf-8",
        )
        self._index.append(version)
        self._persist_index(client, dataset)
        return str(parquet_path)

    def read_dataset(
        self,
        client: str,
        dataset: str,
        snapshot_date: date | None = None,
        run_id: str | None = None,
    ) -> pl.DataFrame:
        version = self._resolve(client, dataset, snapshot_date, run_id)
        return pl.read_parquet(version.path)

    def list_versions(self, client: str, dataset: str) -> list[DatasetVersion]:
        self._load_index(client, dataset)
        versions = [
            v for v in self._index if v.client == client and v.dataset == dataset
        ]
        return sorted(
            versions,
            key=lambda v: (v.snapshot_date, v.extracted_at),
            reverse=True,
        )

    def _resolve(
        self,
        client: str,
        dataset: str,
        snapshot_date: date | None,
        run_id: str | None,
    ) -> DatasetVersion:
        versions = self.list_versions(client, dataset)
        if not versions:
            raise FileNotFoundError(f"Sem versões para {client}/{dataset}")

        if run_id:
            for v in versions:
                if v.run_id == run_id and (
                    snapshot_date is None or v.snapshot_date == snapshot_date
                ):
                    return v
            raise FileNotFoundError(f"run_id não encontrado: {run_id}")

        if snapshot_date:
            dated = [v for v in versions if v.snapshot_date == snapshot_date]
            if not dated:
                raise FileNotFoundError(
                    f"Sem versão em {snapshot_date} para {client}/{dataset}"
                )
            return dated[0]

        return versions[0]

    def _persist_index(self, client: str, dataset: str) -> None:
        index_path = self.data_root / client / "raw" / dataset / "_versions.json"
        versions = [
            asdict(v)
            for v in self._index
            if v.client == client and v.dataset == dataset
        ]
        index_path.parent.mkdir(parents=True, exist_ok=True)
        index_path.write_text(json.dumps(versions, default=str, indent=2), encoding="utf-8")

    def _load_index(self, client: str, dataset: str) -> None:
        index_path = self.data_root / client / "raw" / dataset / "_versions.json"
        if not index_path.exists():
            # descobrir a partir dos meta.json
            root = self.data_root / client / "raw" / dataset
            if not root.exists():
                return
            for meta in root.glob("snapshot_date=*/run_*.meta.json"):
                data = json.loads(meta.read_text(encoding="utf-8"))
                version = DatasetVersion(
                    client=data["client"],
                    dataset=data["dataset"],
                    snapshot_date=date.fromisoformat(str(data["snapshot_date"])[:10]),
                    run_id=data["run_id"],
                    path=data["path"],
                    rows=int(data["rows"]),
                    checksum=data["checksum"],
                    connector=data["connector"],
                    extracted_at=datetime.fromisoformat(data["extracted_at"]),
                    status=data.get("status", "success"),
                )
                if version not in self._index:
                    self._index.append(version)
            return

        for data in json.loads(index_path.read_text(encoding="utf-8")):
            version = DatasetVersion(
                client=data["client"],
                dataset=data["dataset"],
                snapshot_date=date.fromisoformat(str(data["snapshot_date"])[:10]),
                run_id=data["run_id"],
                path=data["path"],
                rows=int(data["rows"]),
                checksum=data["checksum"],
                connector=data["connector"],
                extracted_at=datetime.fromisoformat(data["extracted_at"]),
                status=data.get("status", "success"),
            )
            if all(
                not (
                    v.client == version.client
                    and v.dataset == version.dataset
                    and v.run_id == version.run_id
                    and v.snapshot_date == version.snapshot_date
                )
                for v in self._index
            ):
                self._index.append(version)

    @staticmethod
    def _sha256(path: Path) -> str:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
