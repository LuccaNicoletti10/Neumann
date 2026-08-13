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
  → COMMIT → outbox side effects → audit / operational events
```

External webhooks/writeback **after** commit, via outbox workers.
