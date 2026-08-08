"""Framework de transforms com decorator @transform — funções puras + lineage."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import polars as pl
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from planner.core.errors import DedupConflictError
from planner.core.pipeline.raw import RawLayer, new_run_id
from planner.core.pipeline.schema_map import SchemaMapConfig, SchemaMapLoader, apply_schema_map
from planner.core.pipeline.schemas import SCHEMA_BY_OUTPUT
from planner.core.pipeline.validation import validate_clean_dataset

logger = logging.getLogger(__name__)

# Chave de negócio por dataset — NUNCA deduplicar só por sku quando a chave é composta.
DEDUP_KEYS_BY_OUTPUT: dict[str, list[str]] = {
    "clean.products": ["sku"],
    "clean.sales": ["id"],
    "clean.inventory": ["sku", "snapshot_date", "location"],
    "clean.open_orders": ["id"],
    "clean.production_orders": ["id"],
    "clean.machines": ["id"],
    "clean.work_centers": ["id"],
    "clean.bom": ["parent_sku", "component_sku"],
    "clean.routings": ["sku", "step"],
    "clean.compatibility": ["sku", "machine_id"],
    "clean.setup_matrix": ["machine_id", "from_family", "to_family"],
    "clean.machine_calendar": ["machine_id", "date"],
    "clean.maintenance": ["id"],
    "clean.quality_events": ["id"],
}


@dataclass
class Context:
    """Contexto do cliente para transforms (configs, mappings, regras)."""

    client: str
    config_root: Path
    data_root: Path
    run_id: str
    mode: str = "operational"  # demo | operational
    mappings: dict[str, SchemaMapConfig] = field(default_factory=dict)
    rules: dict[str, Any] = field(default_factory=dict)
    session_factory: sessionmaker | None = None

    def mapping(self, name: str) -> SchemaMapConfig | None:
        return self.mappings.get(name)

    @classmethod
    def load(
        cls,
        client: str,
        config_root: str | Path,
        data_root: str | Path,
        run_id: str | None = None,
        mode: str = "operational",
        session_factory: sessionmaker | None = None,
    ) -> Context:
        config_root = Path(config_root)
        data_root = Path(data_root)
        client_dir = config_root / client
        mappings = SchemaMapLoader().load_directory(client_dir / "mappings")
        rules: dict[str, Any] = {}
        rules_dir = client_dir / "rules"
        if rules_dir.exists():
            import yaml

            for path in rules_dir.glob("*.yaml"):
                rules[path.stem] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return cls(
            client=client,
            config_root=config_root,
            data_root=data_root,
            run_id=run_id or new_run_id(),
            mode=mode,
            mappings=mappings,
            rules=rules,
            session_factory=session_factory,
        )


@dataclass
class TransformSpec:
    name: str
    inputs: list[str]
    output: str
    fn: Callable[..., pl.DataFrame]
    output_schema: Any | None = None
    required: bool = False  # se True e RAW ausente → erro em operational
    dedup_keys: list[str] | None = None


class TransformRegistry:
    def __init__(self) -> None:
        self._transforms: dict[str, TransformSpec] = {}

    def register(self, spec: TransformSpec) -> None:
        self._transforms[spec.name] = spec

    def get(self, name: str) -> TransformSpec:
        return self._transforms[name]

    def all(self) -> list[TransformSpec]:
        return list(self._transforms.values())

    def topological_order(self) -> list[TransformSpec]:
        remaining = list(self._transforms.values())
        produced: set[str] = set()
        ordered: list[TransformSpec] = []
        safety = 0
        while remaining and safety < 1000:
            safety += 1
            progress = False
            for spec in list(remaining):
                deps_ok = True
                for inp in spec.inputs:
                    if inp.startswith("raw."):
                        continue
                    if not any(inp == s.output for s in ordered):
                        deps_ok = False
                        break
                if deps_ok:
                    ordered.append(spec)
                    produced.add(spec.output)
                    remaining.remove(spec)
                    progress = True
            if not progress:
                ordered.extend(remaining)
                break
        return ordered


_REGISTRY = TransformRegistry()


def transform(
    inputs: list[str],
    output: str,
    output_schema: Any | None = None,
    required: bool = False,
    dedup_keys: list[str] | None = None,
) -> Callable[[Callable[..., pl.DataFrame]], Callable[..., pl.DataFrame]]:
    """Decorator que registra um transform puro no registry global."""

    def decorator(fn: Callable[..., pl.DataFrame]) -> Callable[..., pl.DataFrame]:
        keys = dedup_keys if dedup_keys is not None else DEDUP_KEYS_BY_OUTPUT.get(output)
        _REGISTRY.register(
            TransformSpec(
                name=fn.__name__,
                inputs=list(inputs),
                output=output,
                fn=fn,
                output_schema=output_schema or SCHEMA_BY_OUTPUT.get(output),
                required=required,
                dedup_keys=list(keys) if keys else None,
            )
        )
        return fn

    return decorator


def get_transform_registry() -> TransformRegistry:
    return _REGISTRY


class TransformRunner:
    """Executa transforms: carrega RAW → função pura → valida → grava clean + lineage."""

    def __init__(self, ctx: Context, raw_layer: RawLayer | None = None) -> None:
        self.ctx = ctx
        self.raw = raw_layer or RawLayer(ctx.data_root, session_factory=ctx.session_factory)
        self.lineage: list[dict[str, Any]] = []
        self.skipped: list[str] = []
        self.outputs: dict[str, str] = {}

    def run_all(self) -> dict[str, str]:
        paths: dict[str, str] = {}
        for spec in get_transform_registry().topological_order():
            try:
                paths[spec.output] = self.run_one(spec)
            except FileNotFoundError as exc:
                if self.ctx.mode == "operational" and spec.required:
                    raise
                logger.warning("Transform %s pulado: %s", spec.name, exc)
                self.skipped.append(spec.output)
        self.outputs = paths
        return paths

    def run_one(self, spec: TransformSpec) -> str:
        frames: list[pl.DataFrame] = []
        source_versions: list[tuple[str, str, str]] = []
        for inp in spec.inputs:
            if inp.startswith("raw."):
                dataset = inp.split(".", 1)[1]
                versions = self.raw.list_versions(self.ctx.client, dataset)
                if not versions:
                    raise FileNotFoundError(f"RAW ausente: {inp}")
                frames.append(self.raw.read_dataset(self.ctx.client, dataset))
                source_versions.append((inp, versions[0].run_id, versions[0].checksum))
            else:
                clean_name = inp.split(".", 1)[-1]
                path = self._latest_clean_path(clean_name)
                frames.append(pl.read_parquet(path))
                source_versions.append((inp, path.stem, ""))

        result = spec.fn(*frames, self.ctx)
        if not isinstance(result, pl.DataFrame):
            raise TypeError(f"Transform {spec.name} deve retornar pl.DataFrame")

        result = _dedup(
            result,
            keys=spec.dedup_keys,
            mode=self.ctx.mode,
            dataset=spec.output,
        )

        dataset_name = spec.output.split(".", 1)[-1]
        result = validate_clean_dataset(spec.output, result)
        if spec.output_schema is not None:
            result = spec.output_schema.validate(result, lazy=True)

        out_dir = (
            self.ctx.data_root
            / self.ctx.client
            / "clean"
            / dataset_name
            / f"snapshot_date={datetime.now(timezone.utc).date().isoformat()}"
        )
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"run_{self.ctx.run_id}.parquet"
        if out_path.exists():
            raise FileExistsError(f"Clean já existe (append-only): {out_path}")
        result.write_parquet(out_path, compression="zstd")

        for source_dataset, source_version, _checksum in source_versions:
            row = {
                "derived_table": spec.output,
                "derived_version": self.ctx.run_id,
                "source_dataset": source_dataset,
                "source_version": source_version,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self.lineage.append(row)
            self._persist_lineage_pg(row)

        lineage_path = self.ctx.data_root / self.ctx.client / "clean" / "_lineage.jsonl"
        with lineage_path.open("a", encoding="utf-8") as f:
            for row in self.lineage[-len(source_versions) :]:
                f.write(json.dumps(row) + "\n")

        return str(out_path)

    def _latest_clean_path(self, dataset: str) -> Path:
        root = self.ctx.data_root / self.ctx.client / "clean" / dataset
        files = sorted(root.glob("snapshot_date=*/run_*.parquet"))
        if not files:
            raise FileNotFoundError(f"Clean ausente: {dataset}")
        return files[-1]

    def _persist_lineage_pg(self, row: dict[str, Any]) -> None:
        if self.ctx.session_factory is None:
            return
        session = self.ctx.session_factory()
        try:
            session.execute(
                text(
                    """
                    INSERT INTO raw_meta.lineage
                        (derived_table, derived_version, source_dataset, source_version, created_at)
                    VALUES
                        (:derived_table, :derived_version, :source_dataset, :source_version, NOW())
                    """
                ),
                row,
            )
            session.commit()
        except Exception:
            session.rollback()
        finally:
            session.close()


def _apply_or_passthrough(df: pl.DataFrame, ctx: Context, mapping_name: str) -> pl.DataFrame:
    mapping = ctx.mapping(mapping_name)
    if mapping is None:
        return df
    return apply_schema_map(df, mapping)


def _dedup(
    df: pl.DataFrame,
    keys: list[str] | None = None,
    *,
    mode: str = "operational",
    dataset: str = "",
) -> pl.DataFrame:
    """
    Deduplica pela chave declarada do dataset.

    Duplicatas idênticas → keep last.
    Duplicatas conflitantes (mesma chave, conteúdo diferente) → erro em operational.
    """
    if df.is_empty() or not keys:
        return df
    present = [k for k in keys if k in df.columns]
    if not present:
        return df
    # location/shift opcionais: se ausentes, usa o que existir
    if len(present) < len(keys):
        missing = set(keys) - set(present)
        # preenche colunas ausentes com null para chave composta estável
        for col in missing:
            if col in ("location", "shift"):
                df = df.with_columns(pl.lit(None).cast(pl.Utf8).alias(col))
                present.append(col)
            else:
                logger.warning(
                    "Dedup %s: coluna de chave ausente %s — pulando dedup",
                    dataset,
                    col,
                )
                return df
        present = [k for k in keys if k in df.columns]

    before = df.height
    # conflito = mesma chave, linhas não idênticas
    variant_counts = (
        df.group_by(present)
        .agg(pl.struct(pl.all()).n_unique().alias("_variants"))
        .filter(pl.col("_variants") > 1)
    )
    if variant_counts.height > 0:
        sample = variant_counts.head(3).to_dicts()
        msg = (
            f"chaves duplicadas com valores conflitantes em {dataset} "
            f"keys={present} exemplos={sample}"
        )
        if mode == "operational":
            raise DedupConflictError(dataset, msg)
        logger.warning("DEMO: %s — mantendo última linha", msg)

    out = df.unique(subset=present, keep="last")
    if out.height < before:
        logger.info(
            "Dedup %s: %s → %s linhas (chave=%s)",
            dataset,
            before,
            out.height,
            present,
        )
    return out


def _ensure_cols(df: pl.DataFrame, defaults: dict[str, Any]) -> pl.DataFrame:
    for col, default in defaults.items():
        if col not in df.columns:
            df = df.with_columns(pl.lit(default).alias(col))
    return df


# ---------------------------------------------------------------------------
# Transforms registrados
# ---------------------------------------------------------------------------


@transform(inputs=["raw.products"], output="clean.products", required=True)
def clean_products(products: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(products, ctx, "products")
    df = _ensure_cols(
        df,
        {
            "family": "DEFAULT",
            "lot_multiple": 1.0,
            "lead_time_days": 10,
            "min_stock": None,
            "max_stock": None,
            "min_lot": None,
            "cost": None,
            "active": True,
            "description": None,
        },
    )
    df = df.filter(pl.col("family").is_not_null() & (pl.col("family").cast(pl.Utf8) != ""))
    if "active" in df.columns:
        df = df.with_columns(
            pl.col("active")
            .map_elements(
                lambda v: bool(v)
                if isinstance(v, bool)
                else str(v).lower() in {"1", "s", "sim", "true", "y"},
                return_dtype=pl.Boolean,
            )
            .alias("active")
        )
    for col in ("min_stock", "min_lot", "lot_multiple", "cost", "max_stock"):
        if col in df.columns:
            df = df.with_columns(pl.col(col).cast(pl.Float64, strict=False))
    df = df.with_columns(
        pl.col("lot_multiple").fill_null(1.0).clip(lower_bound=0.0001),
        pl.col("lead_time_days").cast(pl.Int64, strict=False).fill_null(10),
    )
    if "unit" in df.columns:
        df = df.with_columns(
            pl.col("unit")
            .replace({"un": "unit", "pc": "unit", "UN": "unit", "KG": "kg", "MT": "m"})
            .alias("unit")
        )
        df = df.filter(pl.col("unit").is_in(["kg", "m", "unit", "un", "pc"]))
    return df


@transform(inputs=["raw.sales"], output="clean.sales", required=True)
def clean_sales(sales: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(sales, ctx, "sales")
    df = _ensure_cols(df, {"type": "sale", "customer": None, "price": None})
    if "id" not in df.columns:
        df = df.with_columns(
            (pl.col("sku").cast(pl.Utf8) + "-" + pl.col("date").cast(pl.Utf8)).alias("id")
        )
    df = df.with_columns(pl.col("date").cast(pl.Date, strict=False), pl.col("qty").cast(pl.Float64))
    df = df.filter(pl.col("qty") >= 0)
    # cancelamentos → qty 0 type cancel; devoluções type return
    if "type" in df.columns:
        df = df.with_columns(
            pl.when(pl.col("type").cast(pl.Utf8).str.to_lowercase().is_in(["cancel", "cancelled"]))
            .then(pl.lit("cancel"))
            .when(pl.col("type").cast(pl.Utf8).str.to_lowercase().is_in(["return", "devolucao", "devolução"]))
            .then(pl.lit("return"))
            .otherwise(pl.col("type"))
            .alias("type")
        )
    return df


@transform(inputs=["raw.inventory"], output="clean.inventory", required=True)
def clean_inventory(inventory: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(inventory, ctx, "inventory")
    today = datetime.now(timezone.utc).date()
    df = _ensure_cols(
        df,
        {
            "snapshot_date": today,
            "blocked": 0.0,
            "in_qc": 0.0,
            "reserved": 0.0,
            "in_process": 0.0,
            "location": None,
        },
    )
    if "available" not in df.columns and "quantity" in df.columns:
        df = df.rename({"quantity": "available"})
    for col in ("available", "blocked", "in_qc", "reserved", "in_process"):
        df = df.with_columns(pl.col(col).cast(pl.Float64, strict=False).fill_null(0.0))
    df = df.with_columns(pl.col("snapshot_date").cast(pl.Date, strict=False))
    return df


@transform(inputs=["raw.open_orders"], output="clean.open_orders", required=False)
def clean_open_orders(orders: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(orders, ctx, "open_orders")
    df = _ensure_cols(df, {"customer": None, "date": None})
    if "id" not in df.columns:
        df = df.with_columns(pl.col("sku").cast(pl.Utf8).alias("id"))
    return df.with_columns(pl.col("qty").cast(pl.Float64))


@transform(inputs=["raw.production_orders"], output="clean.production_orders", required=False)
def clean_production_orders(orders: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(orders, ctx, "production_orders")
    df = _ensure_cols(df, {"qty_produced": 0.0, "status": "planned", "machine_id": None})
    return df


@transform(inputs=["raw.machines"], output="clean.machines", required=True)
def clean_machines(machines: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(machines, ctx, "machines")
    if "id" not in df.columns and "machine_id" in df.columns:
        df = df.rename({"machine_id": "id"})
    df = _ensure_cols(df, {"hours_per_day": 8.0, "shifts": 1, "efficiency": 1.0, "name": None})
    df = df.with_columns(
        pl.col("hours_per_day").cast(pl.Float64),
        pl.col("shifts").cast(pl.Int64),
        pl.col("efficiency").cast(pl.Float64).clip(0.0, 1.0),
    )
    return df


@transform(inputs=["raw.work_centers"], output="clean.work_centers", required=False)
def clean_work_centers(wcs: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    return _apply_or_passthrough(wcs, ctx, "work_centers")


@transform(inputs=["raw.bom"], output="clean.bom", required=False)
def clean_bom(bom: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(bom, ctx, "bom")
    df = df.with_columns(pl.col("qty_per_unit").cast(pl.Float64))
    # detecta ciclos triviais A→A
    df = df.filter(pl.col("parent_sku") != pl.col("component_sku"))
    return df


@transform(inputs=["raw.routings"], output="clean.routings", required=False)
def clean_routings(routings: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    return _apply_or_passthrough(routings, ctx, "routings")


@transform(inputs=["raw.compatibility"], output="clean.compatibility", required=True)
def clean_compatibility(compat: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(compat, ctx, "compatibility")
    return df.with_columns(pl.col("speed_units_per_hour").cast(pl.Float64))


@transform(inputs=["raw.setup_matrix"], output="clean.setup_matrix", required=True)
def clean_setup_matrix(setup: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(setup, ctx, "setup_matrix")
    if "forbidden" in df.columns:
        df = df.with_columns(
            pl.col("forbidden")
            .map_elements(
                lambda v: bool(v)
                if isinstance(v, bool)
                else str(v).lower() in {"1", "true", "yes", "s", "sim"},
                return_dtype=pl.Boolean,
            )
            .alias("forbidden")
        )
    else:
        df = df.with_columns(pl.lit(False).alias("forbidden"))
    return df.with_columns(pl.col("setup_minutes").cast(pl.Float64))


@transform(inputs=["raw.machine_calendar"], output="clean.machine_calendar", required=False)
def clean_machine_calendar(cal: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    df = _apply_or_passthrough(cal, ctx, "machine_calendar")
    return df.with_columns(
        pl.col("date").cast(pl.Date, strict=False),
        pl.col("available_hours").cast(pl.Float64),
    )


@transform(inputs=["raw.maintenance"], output="clean.maintenance", required=False)
def clean_maintenance(maint: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    return _apply_or_passthrough(maint, ctx, "maintenance")


@transform(inputs=["raw.quality_events"], output="clean.quality_events", required=False)
def clean_quality_events(events: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    return _apply_or_passthrough(events, ctx, "quality_events")
