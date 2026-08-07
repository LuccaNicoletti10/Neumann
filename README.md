# Neumann Planner

Planejamento autônomo de produção com ontologia dinâmica, pipeline imutável e motor de decisão.

## Arquitetura

```
planner/
├── core/          # NÚCLEO UNIVERSAL (não conhece cliente)
│   ├── ontology/  # tipos, parsers, validators, sync
│   ├── pipeline/  # RAW parquet, transforms, schema map, timetravel
│   ├── connectors/
│   ├── engine/    # forecast, netting, scheduler, explain
│   ├── actions/   # action registry + executor + audit
│   ├── ai/        # context + narrator
│   ├── api/       # FastAPI
│   └── config/    # ConfigLoader
├── plugins/       # csv_generic, totvs_protheus
├── app/           # Streamlit MVP
└── migrations/    # Alembic
config/{cliente}/  # YAML declarativo por cliente
docs/discovery.md
```

Regras:
- `core/` nunca importa `plugins/` nem conhece nomes de cliente
- Polars (não Pandas) no pipeline
- Append-only na camada RAW
- Dado inválido não entra na ontologia

## Setup

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

## Comandos

```bash
# Ontologia
python -m planner ontology validate --client nicoletti
python -m planner parse-property --client nicoletti --object Product --property unit --value QL

# Pipeline
python -m planner extract --client nicoletti
python -m planner build --client nicoletti
python -m planner timetravel --client nicoletti --dataset raw.products --date 2026-08-07
python -m planner show --client nicoletti --object Product --key PROD001

# Ingestão tipada (parsers na propriedade)
python -m planner ingest --client nicoletti --dataset products --dry-run

# API / UI
uvicorn planner.core.api.app:app --reload
streamlit run planner/app/streamlit_app.py

# Docker
docker compose up --build
```

## Testes

```bash
pytest -q
```

## Discovery

Ver `docs/discovery.md` (família têxtil, fio de ouro Protheus, regras tácitas).
