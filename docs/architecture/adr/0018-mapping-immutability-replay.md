# ADR-0018: Mapping versions are immutable in PostgreSQL; nonce and replay are distinct

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: none (`INGESTION_NONCE_REPLAY` / `INGESTION_EVENT_CONFLICT` remain the codes from ADR-0017)
- Packages touched: `ingestion-runtime`, `platform-api`, `object-platform` (migration runner only)
- Migration: `infra/sql/0024_mapping_immutability.sql`
- Does not alter: `0001`–`0023`, ADRs 0001–0016
- Clarifies ADR-0017 nonce vs event-id replay

## Context

ADR-0017 made `mapping_versions` append-only in the repository. PostgreSQL still allowed `UPDATE`/`DELETE`. Nonce reuse was easy to confuse with identical event replay. Schema-isolated Vitest and `logger: false` were being treated as production proofs they are not.

Delayed checkpoint after `ProjectionWriter` commit is safe only if the ledger claimed `sourceEventId` first. A crash between those steps must be replayable on a new pool, not on the same runtime.

## Decision

`0024` installs a `BEFORE UPDATE OR DELETE` trigger on `mapping_versions` so published rows are immutable in SQL. Identical content hash still returns the existing version. Concurrent insert of the same `(mapping_id, version_number)` has one winner (unique constraint). A failed publish transaction does not change already-published rows.

Webhook nonces have `expires_at` indexed. `purgeExpiredNonces` deletes only rows whose `expires_at` is at or before `now`. A nonce still inside the window is never removed. An expired timestamp is rejected by HMAC verification even after its nonce row was purged.

Replay semantics, without overlap:

| Input | Result |
|---|---|
| Same `sourceEventId` + same payload + **new** nonce | Same receipt (`replayed`) |
| Same `sourceEventId` + different payload | `INGESTION_EVENT_CONFLICT` |
| Same nonce reused | `INGESTION_NONCE_REPLAY` |
| Timestamp outside skew | `WebhookTimestampError`, even if the nonce was already purged |

A test-only failpoint may run after `ProjectionWriter` commit and before checkpoint update. Production does not set it. Delayed checkpoint is safe because the ledger already made domain effects exactly-once.

`pnpm verify:migrations:fresh` proves `0001`→`0024` on a disposable **empty database** (`CREATE DATABASE`), outside the Vitest pool. Schema isolation remains a speed path; it is not that proof. Log redaction is proved by a spy logger and unique sentinels, not by `logger: false`.

## Consequences

### Positivas

- Published mappings cannot be rewritten in PostgreSQL.
- Nonce table growth is bounded by TTL purge without accepting expired requests.
- Crash after domain commit cannot duplicate objects/links/history/events/audit/outbox/ledger.

### Negativas / custo

- `0024` is required before production ingest; `db:migrate` must apply it.
- Empty-database gate needs `CREATEDB`. Denial is fail-closed, not a skip.

### Invariantes que os testes devem provar

- SQL: INSERT ok; UPDATE definition fails; UPDATE hash fails; DELETE fails.
- Concurrent `(mappingId, version)` → one row.
- Identical content does not create a new version; a failed transaction leaves published rows unchanged.
- Purge removes only expired nonces; a valid nonce remains; expired timestamp still fails after purge.
- PostgreSQL crash window uses two independent pools; counts stay at 1.
- Spy logger serializes with no sentinels in secret, signature, Authorization, payload, nested config, or connector error message.

## Alternatives considered

### Alt A — Keep immutability only in the repository

Rejected. Direct SQL or another client could rewrite `definition` / `content_hash`.

### Alt B — Treat nonce reuse as identical replay

Rejected. A stolen nonce must not return `202 replayed`. Event identity is `sourceEventId` + payload hash; nonce is one-time inside the skew window.

## Migration

Append-only `infra/sql/0024_mapping_immutability.sql`. Do not edit `0001`–`0023`.

## Follow-up

None for this decision. HTTP ingest and durable catalog remain ADR-0017.
