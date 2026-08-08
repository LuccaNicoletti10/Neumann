"""Camada RAW imutável — datasets versionados em Parquet (append-only)."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import polars as pl
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker


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


def new_run_id() -> str:
    """run_id único (microssegundos + uuid curto) — evita colisão no mesmo segundo."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    return f"{ts}_{uuid4().hex[:8]}"


class RawLayer:
    """
    Persistência append-only de datasets brutos.

    NUNCA delete, NUNCA sobrescreva. Cada write cria nova versão.
    Índice _versions.json gravado atomicamente (tmp → fsync → rename).
    """

    def __init__(
        self,
        data_root: str | Path,
        session_factory: sessionmaker | None = None,
    ) -> None:
        self.data_root = Path(data_root)
        self._index: list[DatasetVersion] = []
        self._session_factory = session_factory

    def write_dataset(
        self,
        client: str,
        dataset: str,
        df: pl.DataFrame,
        run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        *,
        snapshot_date: date | None = None,
    ) -> str:
        metadata = metadata or {}
        run_id = run_id or new_run_id()
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

        # Carrega índice existente ANTES de gravar nova versão
        self._load_index(client, dataset)

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
        self._persist_index_atomic(client, dataset)
        self._persist_postgres(version)
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

    def _persist_index_atomic(self, client: str, dataset: str) -> None:
        """Grava _versions.json via tmp + fsync + rename atômico."""
        index_path = self.data_root / client / "raw" / dataset / "_versions.json"
        versions = [
            asdict(v)
            for v in self._index
            if v.client == client and v.dataset == dataset
        ]
        # Dedup por (snapshot_date, run_id)
        seen: set[tuple[str, str]] = set()
        unique: list[dict[str, Any]] = []
        for row in versions:
            key = (str(row["snapshot_date"]), str(row["run_id"]))
            if key in seen:
                continue
            seen.add(key)
            unique.append(row)

        index_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = index_path.with_suffix(".json.tmp")
        payload = json.dumps(unique, default=str, indent=2)
        with tmp_path.open("w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, index_path)

    def _rebuild_from_meta(self, client: str, dataset: str) -> list[DatasetVersion]:
        root = self.data_root / client / "raw" / dataset
        found: list[DatasetVersion] = []
        if not root.exists():
            return found
        for meta in root.glob("snapshot_date=*/run_*.meta.json"):
            data = json.loads(meta.read_text(encoding="utf-8"))
            found.append(self._version_from_dict(data))
        return found

    def _load_index(self, client: str, dataset: str) -> None:
        index_path = self.data_root / client / "raw" / dataset / "_versions.json"
        rebuilt = self._rebuild_from_meta(client, dataset)

        loaded: list[DatasetVersion] = []
        if index_path.exists():
            try:
                raw = json.loads(index_path.read_text(encoding="utf-8"))
                if not isinstance(raw, list):
                    raise ValueError("índice inválido")
                loaded = [self._version_from_dict(d) for d in raw]
            except Exception:
                loaded = []

        # Se índice inconsistente com meta.json, reconstruir
        meta_keys = {(v.snapshot_date, v.run_id) for v in rebuilt}
        index_keys = {(v.snapshot_date, v.run_id) for v in loaded}
        if meta_keys != index_keys:
            merged = { (v.snapshot_date, v.run_id): v for v in rebuilt }
            for v in loaded:
                merged.setdefault((v.snapshot_date, v.run_id), v)
            loaded = list(merged.values())

        # Merge no índice em memória sem perder outros datasets
        keep = [v for v in self._index if not (v.client == client and v.dataset == dataset)]
        self._index = keep + loaded

    def _persist_postgres(self, version: DatasetVersion) -> None:
        if self._session_factory is None:
            return
        session = self._session_factory()
        try:
            session.execute(
                text(
                    """
                    INSERT INTO raw_meta.dataset_versions
                        (client, dataset, snapshot_date, run_id, path, rows, checksum,
                         connector, extracted_at, status)
                    VALUES
                        (:client, :dataset, :snapshot_date, :run_id, :path, :rows, :checksum,
                         :connector, :extracted_at, :status)
                    ON CONFLICT (client, dataset, snapshot_date, run_id) DO UPDATE SET
                        path = EXCLUDED.path,
                        rows = EXCLUDED.rows,
                        checksum = EXCLUDED.checksum,
                        status = EXCLUDED.status
                    """
                ),
                {
                    "client": version.client,
                    "dataset": version.dataset,
                    "snapshot_date": version.snapshot_date,
                    "run_id": version.run_id,
                    "path": version.path,
                    "rows": version.rows,
                    "checksum": version.checksum,
                    "connector": version.connector,
                    "extracted_at": version.extracted_at,
                    "status": version.status,
                },
            )
            session.commit()
        except Exception:
            session.rollback()
            # metadata Postgres é best-effort no extract; health detecta divergência
        finally:
            session.close()

    @staticmethod
    def _version_from_dict(data: dict[str, Any]) -> DatasetVersion:
        return DatasetVersion(
            client=data["client"],
            dataset=data["dataset"],
            snapshot_date=date.fromisoformat(str(data["snapshot_date"])[:10]),
            run_id=data["run_id"],
            path=data["path"],
            rows=int(data["rows"]),
            checksum=data["checksum"],
            connector=data["connector"],
            extracted_at=datetime.fromisoformat(str(data["extracted_at"]).replace("Z", "+00:00")),
            status=data.get("status", "success"),
        )

    @staticmethod
    def _sha256(path: Path) -> str:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
