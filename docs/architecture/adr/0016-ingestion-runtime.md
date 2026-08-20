# ADR-0016: Connectors produce envelopes; IngestionRuntime is the only path to ProjectionWriter

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/ingestion.ts` (`RawEnvelope`, `ConnectorPage`, `MappingDefinition`, `IngestionRuntime`), `packages/contracts/src/v1/projection.ts` (`ProjectionBatchCommand.ontologyVersionId`)
- Packages touched: `contracts`, `ingestion-runtime`, `object-platform`, `platform-api`
- Migration: `infra/sql/0022_ingestion_runtime.sql`
- Does not alter: `0001`–`0021`, ADRs 0001–0015

## Context

Connectors already emit `CanonicalEvent`. Mapping already lives as `MappingVersion` on `ObjectPlatform`. Ingest already writes through `ProjectionWriter` (ADR-0005). What was missing was a single deep module that:

```
Connector → RawEnvelope → MappingVersion pin → ProjectionBatch → ProjectionWriter
```

without connectors knowing repositories, ontology internals, policy, or SQL, and without HTTP calling `ProjectionWriter` directly.

Three decisions used to leak into callers: which mapping version, which ontology version, and when a failed envelope is retried versus quarantined.

## Decision

`IngestionRuntime` is the only authority that turns source envelopes into `ProjectionWriter` commands.

External surface:

- `enqueueWebhook`
- `startPull`
- `runOnce`
- `getRun`
- `retryQuarantined`

Connectors implement `Connector` / `ConnectorV2` and produce envelopes only. CSV, HTTP, and webhook stay generic — no company rules.

`MappingVersion` in `object-platform.ts` remains the catalog record. `MappingDefinition` is `Pick` of that record (object type, primary key, property/link mappings). The run stores an `IngestionMappingPin` (id, version, hash, ontology pin, definition) at start and never calls `getLatest` again.

`RawEnvelope` is the ingestion-facing subset of `CanonicalEvent`. Conversion happens at the runtime boundary so the frozen Connector contract does not grow a twin event type.

`ProjectionBatchCommand.ontologyVersionId` carries the ontology pin from the mapping. `ProjectionWriter` passes it to `OntologyVersionPolicy.pin({ kind: 'create', requested })` so a publish mid-run cannot change the schema of that batch.

Durable run/lease/quarantine/checkpoint state lives in `0022`. Checkpoint uses the existing `CheckpointStore` port (connector-sdk); the PG adapter is not a second checkpoint concept. Clock, ids, outbox, policy, and `ProjectionWriter` are injected — not reimplemented.

Failed transformation, deny, conflict, and exhausted retry go to quarantine with the **same pin**. `retryQuarantined` replays that pin; it does not pick latest.

## Consequences

### Positivas

- One ingest pipeline for pull and push.
- Mapping and ontology cannot drift mid-run.
- Connectors remain ignorant of the domain.

### Negativas / custo

- Mapping catalog Maps on `ObjectPlatform` are still process-local (open decision 2). The run pin is durable, so restart does not re-resolve latest.
- HMAC verification for webhooks is in the runtime (secret injected). `connector-webhook` keeps the same algorithm for its own tests.

### Invariantes que os testes devem provar

- CSV, HTTP, and webhook envelopes become objects only through `ProjectionWriter`.
- Publishing a new mapping after `startPull` does not change the running pin.
- Missing primary key quarantines; no partial object.
- Replay of `sourceEventId` is a no-op; divergent payload conflicts and quarantines.
- Concurrent `runOnce` on one run: one lease winner.
- Retry uses the quarantined pin, not latest.
- PG restart preserves pin, checkpoint, and quarantine.
- Connectors do not import `object-platform`, `ontology-registry`, or `policy-engine`.

## Alternatives considered

### Alt A — Connectors call ProjectionWriter

Rejected. Would teach every source about ObjectType, policy, and SQL.

### Alt B — Reuse ObjectPlatform.project as the ingest path

Rejected. That facade is mapping+project for CLI/demo. Production ingest is `ProjectionWriter` (ADR-0005).

### Alt C — New MappingVersion type replacing the catalog record

Rejected. A twin of the frozen `MappingVersion` would split the source of truth.

## Migration

Apply `0022` on an empty database and as an upgrade from `0021`. Do not edit `0001`–`0021`.

## Follow-up

Closed by ADR-0017: durable connector/mapping catalog, HTTP ingest adapter, operational worker.
