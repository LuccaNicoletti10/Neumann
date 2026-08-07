"""Framework de transforms com decorator @transform — funções puras + lineage."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import polars as pl

from .raw import RawLayer
from .schema_map import SchemaMapConfig, SchemaMapLoader, apply_schema_map
from .validation import validate_clean_dataset


@dataclass
class Context:
    """Contexto do cliente para transforms (configs, mappings, regras)."""

    client: str
    config_root: Path
    data_root: Path
    run_id: str
    mappings: dict[str, SchemaMapConfig] = field(default_factory=dict)
    rules: dict[str, Any] = field(default_factory=dict)

    def mapping(self, name: str) -> SchemaMapConfig:
        try:
            return self.mappings[name]
        except KeyError as exc:
            raise KeyError(f"Mapping não encontrado: {name}") from exc

    @classmethod
    def load(
        cls,
        client: str,
        config_root: str | Path,
        data_root: str | Path,
        run_id: str | None = None,
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
            run_id=run_id or datetime.now(timezone.utc).strftime("%H%M%S"),
            mappings=mappings,
            rules=rules,
        )


@dataclass
class TransformSpec:
    name: str
    inputs: list[str]
    output: str
    fn: Callable[..., pl.DataFrame]
    output_schema: Any | None = None


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
        # ordenação simples por dependência de outputs já produzidos
        remaining = list(self._transforms.values())
        produced: set[str] = set()
        ordered: list[TransformSpec] = []
        # inputs raw.* sempre disponíveis
        safety = 0
        while remaining and safety < 1000:
            safety += 1
            progress = False
            for spec in list(remaining):
                deps_ok = True
                for inp in spec.inputs:
                    if inp.startswith("raw."):
                        continue
                    if inp not in produced and inp.replace("clean.", "") not in {
                        s.output.replace("clean.", "") for s in ordered
                    }:
                        # também aceita se output de outro transform bate
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
) -> Callable[[Callable[..., pl.DataFrame]], Callable[..., pl.DataFrame]]:
    """Decorator que registra um transform puro no registry global."""

    def decorator(fn: Callable[..., pl.DataFrame]) -> Callable[..., pl.DataFrame]:
        _REGISTRY.register(
            TransformSpec(
                name=fn.__name__,
                inputs=list(inputs),
                output=output,
                fn=fn,
                output_schema=output_schema,
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
        self.raw = raw_layer or RawLayer(ctx.data_root)
        self.lineage: list[dict[str, Any]] = []

    def run_all(self) -> dict[str, str]:
        paths: dict[str, str] = {}
        for spec in get_transform_registry().topological_order():
            paths[spec.output] = self.run_one(spec)
        return paths

    def run_one(self, spec: TransformSpec) -> str:
        frames: list[pl.DataFrame] = []
        source_versions: list[tuple[str, str]] = []
        for inp in spec.inputs:
            if inp.startswith("raw."):
                dataset = inp.split(".", 1)[1]
                versions = self.raw.list_versions(self.ctx.client, dataset)
                if not versions:
                    raise FileNotFoundError(f"RAW ausente: {inp}")
                frames.append(self.raw.read_dataset(self.ctx.client, dataset))
                source_versions.append((inp, versions[0].run_id))
            else:
                # clean já gravado
                clean_name = inp.split(".", 1)[-1]
                path = self._latest_clean_path(clean_name)
                frames.append(pl.read_parquet(path))
                source_versions.append((inp, path.stem))

        result = spec.fn(*frames, self.ctx)
        if not isinstance(result, pl.DataFrame):
            raise TypeError(f"Transform {spec.name} deve retornar pl.DataFrame")

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
        result.write_parquet(out_path, compression="zstd")

        for source_dataset, source_version in source_versions:
            self.lineage.append(
                {
                    "derived_table": spec.output,
                    "derived_version": self.ctx.run_id,
                    "source_dataset": source_dataset,
                    "source_version": source_version,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )
        lineage_path = (
            self.ctx.data_root / self.ctx.client / "clean" / "_lineage.jsonl"
        )
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


# Transform padrão de produtos (registrado ao importar)
@transform(inputs=["raw.products"], output="clean.products")
def clean_products(products: pl.DataFrame, ctx: Context) -> pl.DataFrame:
    mapping = ctx.mapping("products")
    df = apply_schema_map(products, mapping)
    # normaliza tipos básicos para Pandera
    if "active" in df.columns:
        df = df.with_columns(
            pl.col("active")
            .map_elements(
                lambda v: bool(v) if isinstance(v, bool) else str(v).lower() in {"1", "s", "sim", "true", "y"},
                return_dtype=pl.Boolean,
            )
            .alias("active")
        )
    for col in ("min_stock", "min_lot", "cost", "max_stock"):
        if col in df.columns:
            df = df.with_columns(pl.col(col).cast(pl.Float64, strict=False))
    if "unit" in df.columns:
        df = df.with_columns(
            pl.col("unit")
            .replace({"un": "unit", "pc": "unit", "UN": "unit"})
            .alias("unit")
        )
        df = df.filter(pl.col("unit").is_in(["kg", "m", "unit", "un", "pc"]))
    return df
