# NEUMANN — enterprise operational data & decision platform

Neumann is a **generic Foundry-inspired platform kernel**, not a production planner or any vertical application.

```
DATA → DATASETS / PIPELINES → ONTOLOGY → OBJECTS / LINKS / OBJECTSETS
    → FUNCTIONS → ACTIONS → APPLICATIONS / AGENTS → WRITEBACK → NEW DATA
```

Domain concepts (forecast, netting, scheduling, SKUs, machines, ERP systems, …) belong only in **`apps/`**, never in `packages/`.

```
applications  →  platform
```

Spec: [`GUIA_PASSO_A_PASSO.md`](GUIA_PASSO_A_PASSO.md) · apps boundary: [`apps/README.md`](apps/README.md) · attribution: [`NOTICE`](NOTICE)

## Architecture (modular monolith)

| Layer | Packages |
|---|---|
| Contracts | `contracts` |
| Connect / memory / transform | connectors, HPP, delta, transforms, quality, sandbox |
| Lineage + policy | `data-lineage`, `policy-engine` |
| Ontology | `ontology-registry` |
| Objects + links | `object-platform` (ObjectRepository / LinkRepository + PG adapters) |
| ObjectSets | `object-set` (BASE · FILTER · UNION · INTERSECT · SUBTRACT · STATIC · SEARCH_AROUND) |
| Actions | `action-engine` (authorize → validate → criteria → rules → side effects → audit) |
| HTTP `/api/v2` | `platform-api` |
| Applications | `apps/*` (consumers only) |

Persistence: in-memory for gates; PostgreSQL schema in `infra/sql/0002_objects_platform.sql` with `createPgObjectRepository` / `createPgLinkRepository`.

API shapes adapted from [OpenFoundry](https://github.com/Przyval/openfoundry) (Apache-2.0) — see `NOTICE`. OpenFoundry’s `/tmp` JSON stores are **not** used.

## Status

| Bloco | Passos | Status |
|---|---|---|
| 1 Fundação | 1–4 | **ENTREGUE** |
| 2 Connect | 5–7 | **ENTREGUE** |
| 3 Memória imutável | 8–10 | **ENTREGUE** |
| 4 Transform | 11–14 | **ENTREGUE** |
| 5 Lineage + segurança | 15–16 | **ENTREGUE** |
| 6 Ontology | 17–19 | **ENTREGUE** |
| 7 Entity Resolution | 20–22 | **Passo 20 ENTREGUE**; 21–22 próximo |
| 8 Functions + Actions | 23–24 | **Action engine + `/api/v2` milestone** |

## Quick start

```bash
pnpm install && pnpm build && pnpm test
pnpm --filter platform-api test   # Customer / SalesOrder / Product + ObjectSet + Action
pnpm gate:bloco1
pnpm gate:t1.3
pnpm dev:up                       # Postgres (+ objects schema) + Jaeger + Prometheus + Grafana
```

### `/api/v2` (platform-api)

```
/api/v2/ontologies
/api/v2/ontologies/{ontology}/objectTypes
/api/v2/ontologies/{ontology}/objects/{objectType}
/api/v2/ontologies/{ontology}/objects/{objectType}/{primaryKey}
/api/v2/ontologies/{ontology}/objects/{objectType}/{primaryKey}/links/{linkType}
/api/v2/ontologies/{ontology}/objectSets/loadObjects
/api/v2/ontologies/{ontology}/objectSets/aggregate
/api/v2/ontologies/{ontology}/actionTypes
/api/v2/ontologies/{ontology}/actions/{action}/validate
/api/v2/ontologies/{ontology}/actions/{action}/apply
```

## Packages

| Pacote | Papel |
|---|---|
| `common-build-system` / `dynamic-documentation` | Passo 1 |
| `observability` / `auto-logging-config` / `metrics-collection` | Passo 2 |
| `iam-auth-monitoring` / `security-config-secrets` | Passo 3 |
| `event-bus` / `fair-query-scheduler` / `bounded-fair-scheduler` | Passo 4 |
| `contracts` / `connector-sdk` | Passo 5 |
| `connector-postgres` + ITS/ECE/TIP | Passo 6 |
| `schema-registry` | Passo 7 |
| `history-preserving-pipeline` | Passo 8 |
| `delta-storage` | Passo 9 |
| `multi-row-transactions` | Passo 10 |
| `transformation-runner` | Passo 11 |
| `incremental-pipeline-scheduler` | Passo 12 |
| `data-quality` | Passo 13 |
| `execution-sandbox` | Passo 14 |
| `data-lineage` | Passo 15 |
| `policy-engine` | Passo 16 |
| `ontology-registry` | Passo 17 |
| `object-platform` | Passo 18 + Object/Link repositories |
| `knowledge-graph` | Passo 19 |
| `entity-resolution` | Passo 20 |
| `object-set` | ObjectSet algebra |
| `action-engine` | Generic ActionExecutor |
| `platform-api` | Foundry-like `/api/v2` |
| LCV / EAD / VRN / CSD | patentes de suporte Passo 5 |
| `ldpc-transceiver` / `periodic-search-manager` | suporte Bloco 1 |

## Validate

```bash
pnpm onto -- demo && pnpm obj -- demo && pnpm kg -- demo && pnpm er -- demo
pnpm --filter object-set test
pnpm --filter action-engine test
pnpm --filter platform-api test
```
