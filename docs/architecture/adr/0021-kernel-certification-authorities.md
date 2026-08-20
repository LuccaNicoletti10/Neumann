# ADR-0021: Kernel certification authorities

- Status: accepted
- Date: 2026-08-20
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/outbox.ts` (`OutboxDispatcher`), `packages/contracts/src/v1/object-repository.ts` (`listAll`), `packages/contracts/src/v1/function-runtime.ts` (`readSeq`)
- Packages touched: `object-platform`, `event-bus`, `function-registry`, `platform-api`, `knowledge-graph`, `action-engine`
- Migration: `infra/sql/0026_history_seq_function_read_seq.sql`
- Does not alter: `0001`–`0025`, ADRs 0001–0020

## Context

Prompt 12 certifies the kernel before a real company integrates. Three production lies remained:

1. `PostgresOutboxStore` and `createPgOutboxRepository` were two write APIs on `outbox_events`. The worker spoke raw SQL. Memory outbox could not claim/ack/dead-letter.
2. Function `readAsOf` was a per-process clock instant. Two replicas with a frozen timestamp could disagree on which history row was visible.
3. `GraphQueryEngine.checkIntegrity` returned `linkCount: 0` / `objectCount: 0` without scanning repositories.

Search (`query-api` inverted index) is a CLI projection and is not mounted on `/api/v2`. Catalog search is SQL over `0013`. That split stays; the gate forbids `platform-api` from importing `query-api` or `PostgresOutboxStore`.

## Decision

### Outbox

One port: `OutboxRepository` (insert) plus `OutboxDispatcher` (claim / delivered / retry / dead-letter / unhandled). One table: `outbox_events`. `createPgOutboxRepository` and `createMemoryOutboxRepository` implement both. `createOutboxWorker` dispatches through that port. `PostgresOutboxStore` remains an event-bus CLI adapter over the same table and must not be imported from `platform-api`.

Producers (Actions, ProjectionWriter, ingestion) insert in the same UnitOfWork as the domain write. Delivery is at-least-once; consumers are idempotent; poison rows become `DEAD_LETTER` after `maxAttempts`.

### Temporal frontier

`platform_object_history.seq` is a database sequence (`platform_history_seq`). `asOf` with a sequence watermark is `seq <= readSeq`. Function executions persist `readSeq` alongside `readAsOf`. `readAsOf` remains the sandbox clock pin (ADR-0020). Multi-replica order is the sequence, not the process clock.

Memory history assigns a monotonic `seq` per store instance. Isolated-schema tests share one store/sequence.

### Graph integrity

`ObjectRepository.listAll` / `LinkRepository.listAll` scan one ontology. `checkIntegrity` counts live rows and reports dangling endpoints. Traverse honours every requested `linkTypeId`.

### Production

`assertProductionConfig` refuses memory stores, allow-all fixtures, missing `DATABASE_URL`, degraded policy, and process-local Function registries when `mode=postgres` and `PLATFORM_ENV=production`. `/health` is liveness; `/ready` is policy + migrations + not degraded.

## Consequences

### Positivas

- One outbox table and one dispatcher API.
- Frozen clocks cannot invert Function snapshots across replicas.
- Integrity reports are real.

### Negativas / custo

- `readSeq` is required for new Function executions; rows from 0025 have NULL and fall back to timestamp-only asOf (create path always writes seq after 0026).
- `listAll` is a new repository method; test doubles must implement it.

### Invariantes que os testes devem provar

- Two pools, frozen timestamp: v1 create → Function → v2 update/delete → Function still sees v1.
- Outbox claim CAS, redelivery after crash-before-ack, dead-letter after max attempts; memory and PG share the contract.
- `checkIntegrity` is false on a dangling live link; counts are not the constant 0.
- Production guard throws on memory + `PLATFORM_MODE=postgres` + `PLATFORM_ENV=production`.

## Alternatives considered

### Alt A — Keep timestamp-only asOf and document replica skew

Rejected. Prompt 12 forbids declaring the snapshot correct when it depends only on a per-process clock.

### Alt B — Delete PostgresOutboxStore immediately

Rejected for this ADR. CLI/demo of event-bus still uses `OutboxStore`. Production path is the repository. A later ADR can delete the class once CLI uses the repository.

### Alt C — Mount query-api inverted index on HTTP

Rejected. Objects/Links remain source of truth. Catalog GIN (`0013`) is the HTTP search read model.

## Migration

Append-only `0026`. Do not edit `0001`–`0025`.

## Follow-up

Hostile Function isolation (process/container). HTTP artifact publish. Removing `PostgresOutboxStore`.
