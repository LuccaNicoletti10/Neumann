# ADR-0012: Active link create is CAS upsert, not revive

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/object-repository.ts` `CreateLinkInput.expectedVersion` (comment only)
- Packages touched: `object-platform` (memory + PG link repositories)

## Context

Link `create` already revived a soft-deleted row under `expectedVersion`. A **live** row threw `link already exists` even when `expectedVersion` matched. Tests covered revive only. Semantics for an active link were unspecified.

## Decision

**A — upsert ativo (CAS).** Distinct from revive (`deleted=true`).

- Pure create: `expectedVersion` absent. A live row → `link already exists`.
- Active upsert: `expectedVersion` required. `UPDATE … WHERE version = expectedVersion AND deleted = false`. Updates provenance/`observedAt`, increments `version`. Concurrent callers: one winner (`VERSION_CONFLICT`).
- Revive: `deleted=true` + matching `expectedVersion` (unchanged). Do not call revive “upsert ativo”.

Memory and PostgreSQL share this table.

## Consequences

### Positivas

- Provenance refresh on a live edge is explicit CAS, not a silent overwrite and not a fake `LinkCreated`.

### Negativas / custo

- Callers that meant “create or ignore” must now send `expectedVersion` to update a live row.

### Invariantes que os testes devem provar

- Memory + PG: live + `expectedVersion` → version+1, provenance updated.
- Live without `expectedVersion` → already exists.
- Live + stale version → `VERSION_CONFLICT`.
- PG: two concurrent active upserts, one winner.

## Alternatives considered

### Alt B — no-op ativo

Allow the call only when the material effect is identical; provenance/cardinality/endpoint divergence conflicts; never emit a false `LinkCreated`/`LinkModified`. Rejected: ingestion needs to refresh `observedAt` on a live edge under CAS. A no-op would drop that update.

## Migration

No SQL change. Callers that hit “already exists” on a live row and want an update must pass `expectedVersion`.

## Follow-up

Projection `project_link` still emits `LinkCreated` on create/revive. Active upsert via `LinkRepository.create` is the repository contract; the projector does not call it “revive”.
