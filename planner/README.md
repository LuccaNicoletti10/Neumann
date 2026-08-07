# Planner

Estrutura Clean Architecture do Neumann Planner.

```
planner/
├── core/           # NÚCLEO UNIVERSAL — nunca importa plugins/ nem config/
│   ├── ontology/
│   ├── pipeline/
│   ├── connectors/
│   ├── engine/
│   ├── actions/
│   ├── ai/
│   └── api/
├── plugins/        # Conectores concretos
├── config/nicoletti/
├── app/            # Streamlit MVP
├── migrations/     # Alembic
├── tests/
├── docker-compose.yml
├── pyproject.toml
└── README.md
```

## Regras

1. `core/` NUNCA importa de `plugins/` nem de `config/`
2. Python 3.12+, Polars (não Pandas), FastAPI, PostgreSQL 16
3. Stack: Pandera, OR-Tools, statsforecast, APScheduler, Alembic, pytest

## Subir Postgres

```bash
docker compose -f planner/docker-compose.yml up -d postgres
```

## Instalar (a partir da raiz do repositório)

```bash
pip install -e ".[dev]"
# ou
pip install -e "./planner[dev]"
```
