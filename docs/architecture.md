# Neumann architecture (canonical runtime)

Neumann is an **ontology-centered operational data and decision platform**.

It is **not** a production planner, ERP, BI dashboard, or LLM wrapper.

```
SOURCES → CONNECTORS → CANONICAL EVENTS → VERSIONED DATASETS
  → TRANSFORMS → DATA QUALITY + LINEAGE → ENTITY RESOLUTION
  → ONTOLOGY → OBJECTS + LINKS → OBJECTSETS / GRAPH / FUNCTIONS
  → ACTIONS → WRITEBACK → SOURCE CHANGES → RE-INGEST → NEW STATE
```

## Dependency rule

```
apps/*  →  packages/*     (applications consume platform)
packages/*  ✗→  apps/*    (platform never imports applications)
```

Domain types (Customer, SalesOrder, PlanLine, Forecast, …) live only in `apps/`, tests, or examples.

## One source of truth (Objects / Links)

| Role | Package | Notes |
|---|---|---|
| Current state | `ObjectRepository` / `LinkRepository` | Memory (tests) or PostgreSQL (runtime) |
| Projection | `ObjectProjector` + MappingRegistry | Writes **into** repositories (no private object Maps) |
| History | `ObjectHistoryRepository` | Append-only |
| Provenance | Provenance records | Dataset/mapping/source fields |
| Graph | `GraphQueryEngine` | Query over repositories — not a second store |
| ObjectSets | `object-set` | Memory evaluator + (future) SQL planner |
| Mutations | `OntologyObjectService` + `ActionExecutor` | Schema + policy gated |

## Runtime contexts

- `createMemoryPlatformContext()` — tests / demos
- `createPostgresPlatformContext({ databaseUrl })` — durable API (fail-fast if DB missing)

## Production clock / IDs

- Default: `SystemClock`, `UuidIdGenerator`
- Tests inject `createDeterministicClock` / `createIdGenerator`

## Security path

```
Bearer token → IdentityProvider → Principal → PolicyEngine → resource access
```

`X-Principal` only when `ALLOW_DEV_PRINCIPAL_HEADER=true` (never accidental production).

## Action lifecycle

```
authorize → validate → submission criteria → UnitOfWork(rules)
  → ActionExecution + object/link mutations + operational events
  + audit entry + outbox insert
  → COMMIT
```

External webhooks/writeback **after** commit, via outbox workers (`createOutboxWorker` → `erp_writeback_queue` SQL mirror until an HTTP ERP handler exists).

Production `createPostgresPlatformContext({ sql, transaction, authorize })` is fail-closed: missing `authorize` is a startup error. Memory/tests pass `allowAll` explicitly. Postgres mode wraps `ObjectRepository` with ontology validation + `platform_object_history` snapshots in the same UnitOfWork.

Direct HTTP writes to `/objects` and `/links` are service-only (`svc-projector`, `svc-migration`). Humans use Actions. Generic console: `apps/console/index.html` (not a domain app).

## Package classification

**CORE PLATFORM / CRITICAL PATH** (`pnpm gate:core`):
`contracts`, `api-errors`, `pagination`, `object-platform`, `ontology-registry`, `object-set`, `knowledge-graph`, `action-engine`, `policy-engine`, `connector-sdk`, `connector-postgres`, `event-bus`, `observability`, `platform-api`

**OPTIONAL / EXPERIMENTAL / SUPPORT** (CI completo ainda valida):
`apps/console`, `ldpc-transceiver`, `external-content-exporter`, `tagging-interface-panel`, `periodic-search-manager`, `fair-query-scheduler`, `bounded-fair-scheduler`, `cli-script-debugger`, `entity-assignment-debugger`, `inline-tag-sync`, `link-consistency-validator`, `validation-result-notifier`, and other Bloco 1–4 support packages.

Do not delete optional packages. A broken experimental package must not block `pnpm gate:core`.
