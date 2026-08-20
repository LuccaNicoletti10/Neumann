# ADR-0017: HTTP ingest is a thin adapter; catalog and worker are durable

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/ingestion.ts` (`ConnectorRegistration`, `MappingVersionRepository`, `EnqueueWebhookInput` HMAC fields, `IngestionWebhookResult`)
- Packages touched: `contracts`, `ingestion-runtime`, `platform-api`
- Migration: `infra/sql/0023_ingestion_ingress_catalog.sql`
- Does not alter: `0001`–`0022`, ADRs 0001–0016
- Supersedes follow-up of ADR-0016 (open decision 2 / “no HTTP ingest route”)

## Context

ADR-0016 made `IngestionRuntime` the only path from envelopes to `ProjectionWriter`. Three operational gaps remained:

1. No external HTTP entry. Callers could not push a webhook without in-process `enqueueWebhook`.
2. Connector registrations and published mappings lived in process-local Maps (`ObjectPlatform`). Restart required reseed.
3. Nobody continuously called `runOnce`. A pending run would sit until a test invoked it.

HTTP must not become a second authority. ObjectPlatform mapping Maps must not remain the ingest source of truth.

## Decision

`POST /api/v2/ingest/:connectorId` is a thin adapter. The handler captures raw bytes and calls only `ctx.ingestion.enqueueWebhook(...)`. It does not import repositories, the mapping catalog, the ledger, or `ProjectionWriter`.

HMAC-SHA256 authenticates the webhook (constant-time) over `timestamp + "." + nonce + "." + rawBody`. The secret is resolved by `secretRef` from the connector catalog — never stored in catalog tables. JWT Bearer is not required on this route (`declareHmacIngress`). After HMAC, `IngestionRuntime` authorizes `connector.servicePrincipal` against `admin:ingest`.

`202` is returned only after inbox, envelope, mapping pin, and run are persisted. Identical replay returns the same receipt. Same `sourceEventId` with a different payload is `409 INGESTION_EVENT_CONFLICT`. Invalid signature, expired timestamp, reused nonce, oversized body, or a missing/disabled connector persist zero rows.

The single durable catalog is:

- `ConnectorRegistrationRepository`
- `MappingVersionRepository`

Published mappings are append-only. Identical content hash returns the existing version. Concurrent publish uses a unique `(mapping_id, version_number)` constraint. ObjectPlatform mapping Maps remain a CLI/demo facade and are **not** the ingest catalog.

`connector-webhook` stays a `ConnectorV2` that produces envelopes. It has no HTTP server. The only external webhook surface is `platform-api`.

A worker process, separate from `listen()`, calls `runOnce` after migrations, policy, connector store, and mapping store are ready. Leases are CAS in SQL (`FOR UPDATE SKIP LOCKED` / compare-and-set on `ingestion_runs`). Concurrency is limited, backoff is bounded, `AbortSignal` stops the loop, and graceful stop waits in-flight work. Checkpoint advances only after `ProjectionWriter.projectBatch`. Transport is at-least-once; the projection ledger makes domain effects exactly-once.

Clock and ids are the existing `createSystemClock` / `createUuidIdGenerator` (or test doubles). No fourth factory.

## Consequences

### Positivas

- An ERP can POST a signed webhook without a Bearer token.
- Restart does not require reseeding connectors or mappings.
- Two worker processes cannot process the same run.
- Mapping/ontology pins exist before the client sees `202`.

### Negativas / custo

- ObjectPlatform `createMapping` / `commitMapping` still write process-local Maps. Production ingest and HTTP tests publish through `MappingVersionRepository`.
- HMAC ingress is a third route-policy kind besides public and `authorize-before-handler`.

### Invariantes que os testes devem provar

- HTTP handler source does not import `object-platform`, repositories, or `ProjectionWriter`.
- Invalid HMAC / expired timestamp / reused nonce / oversized body / disabled connector → zero inbox rows.
- Signature over reserialized JSON is rejected.
- Identical replay → same `runId`; divergent payload → 409 and unchanged objects.
- Restart loads connectors and mappings without seed.
- A new published mapping does not change an existing run pin.
- Crash after `projectBatch` and before checkpoint does not duplicate objects.
- Two PostgreSQL workers: one lease winner; expired lease is resumed.
- `partial` and `deny` write nothing.
- Secret never appears in catalog tables or logs.
- Worker abort is graceful and a subsequent start continues.
- CSV cursor and HTTP pagination resume after restart.
- Duplicate quarantine is one row; a failed effect rolls back the whole `ProjectionBatch`.

## Alternatives considered

### Alt A — Authorize the webhook with JWT Bearer

Rejected. External systems that POST webhooks do not hold a Neumann access token. HMAC on the raw body is the ingress authenticator; policy still runs on `servicePrincipal`.

### Alt B — Keep ObjectPlatform Maps as the mapping catalog and snapshot them at boot

Rejected. A process-local Map is not a durable catalog. Restart would reseed.

### Alt C — Worker inside `createPlatformServer` sharing the HTTP event loop

Rejected. The API process must be startable without draining ingest, and the worker must be startable without binding a port.

### Alt D — Second HTTP server in `connector-webhook`

Rejected. Two concurrent external surfaces would split HMAC, receipts, and policy.

## Migration

Apply `0023` on an empty database and as an upgrade from `0022`. Do not edit `0001`–`0022`. Second apply is a checksum no-op. A failing `0023` rolls back and leaves `schema_migrations` at `0022`.

## Follow-up

ObjectPlatform mapping Maps as a write-through to `MappingVersionRepository` (async `commitMapping`) is not this ADR.
