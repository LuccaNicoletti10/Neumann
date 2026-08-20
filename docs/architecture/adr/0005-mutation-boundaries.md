# ADR-0005: Public mutations are Actions; ingest is ProjectionWriter

- Status: accepted
- Date: 2026-08-18
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/projection.ts` (`ProjectionWriter`, command types)
- Packages touched: `object-platform`, `platform-api`, `action-engine`, `policy-engine`, `infra/sql/0017_projection_ledger.sql`
- Closes: ADR-0003 follow-up (write-guard), ADR-0004 follow-up (HTTP object/link writes)

## Context

HTTP POST/PUT/DELETE `/api/v2/.../objects` and POST `/links` called `ObjectRepository` / `LinkRepository` directly. A write-guard allowlisted `svc-projector` / `svc-migration`. UI, LLM, and humans shared that surface with ingest.

That made repositories a business API. HTTP coordinated object + history + event + outbox. Policy could allow a principal and the guard could still write. Target-state §5 required two ports:

```
UI/LLM/human → ActionExecutor
ERP/connector/projector → ProjectionWriter
```

Call-site survey (`rg`): no cross-process projector. `apps/erp-simulator` and platform tests run in-process. No `/internal/v1/projections` HTTP.

## Decision

Two deep modules. Repositories are not public APIs.

### Public HTTP

POST/PUT/DELETE objects and POST links remain as **tombstones**:

- Policy is still declared (`create`/`modify`/`delete` on the object/link resource) so route-closure holds.
- Handler returns `405` `{ errorCode: 'ACTION_REQUIRED', errorName: 'ActionRequired' }`.
- Handler does not call repositories.

`registerV2Routes` receives `PublicPlatformContext`: objects/links are readers. `ProjectionWriter` is not on that type.

`registerWriteGuard` and the `svc-projector` allowlist are removed.

### Actions (business)

Mutating `ActionTypeDef` rules require `idempotencyKey` before claim. Modify/delete/generate_document also require `expectedObjectVersions`. Pipeline unchanged:

```
authorize → validate → transaction → write-back → audit/outbox
```

Unauthorized, stale version, and duplicate key produce no extra effects. Duplicate returns the original execution.

### ProjectionWriter (ingest)

Contract: `projectObject` / `deleteProjectedObject` / `projectLink` / `deleteProjectedLink`.

Identity: `(source, ontologyId, sourceEventId)`. Concurrency: `expectedVersion`. Capability: `ResourceIds.admin('projection')`.

Pipeline:

```
authorize projection capability
→ validate ontology/schema
→ claim sourceEventId
→ transaction: object/link + history + event + existing outbox + ledger complete
```

Replay of the same payload returns the prior result. Same key + different payload is `ProjectionConflictError`. Deny is `ProjectionDeniedError` (no existence leak). Stale version is `VersionConflictError`. Throw after a repository write rolls back the whole unit.

Ledger is **not** `ActionExecution`. Table `projection_ledger` (`0017`). PostgreSQL uniqueness waits on the primary key so concurrent callers yield one commit. Memory ledger waiters await the in-flight claim (JS would otherwise observe a placeholder).

Same-process callers use `ctx.projections`. No public or internal HTTP ingest port.

### Cleanup

`evaluateOverlay` and `createAllowAllAuthorizer` had no runtime callers and are gone. Tests use `createAllowAllTestPolicy`.

## Consequences

### Positivas

- Public `/api/v2` cannot write objects/links except through Actions.
- Ingest has one port with its own idempotency key and ledger.
- Outbox stays the existing `OutboxRepository`.
- HTTP handlers cannot see writer repositories.

### Negativas / custo

- Tombstones stay until a later ADR deletes the routes entirely (clients still get a typed 405).
- Memory projection rollback of event/outbox after a mid-`emit` throw is compensating, not a SQL transaction. Invariant tests inject failure at repository write; PostgreSQL is the production atomicity proof.
- `createObjectPlatform` Maps projector remains a CLI/demo store (open decision 2).

### Invariantes que os testes devem provar

- Public POST/PUT/DELETE objects and POST links do not write (405, row absent).
- Authorized Action writes once; duplicate key replays; stale/deny write zero.
- Authorized projection writes; `sourceEventId` replay does not duplicate; different payload conflicts.
- Injected throw after repository write: object, ledger, event, outbox absent (PG rollback; memory abandon+delete).
- Concurrent same key: one applied commit.
- PG restart: replay still holds.
- Deny projection writes nothing and does not reveal existence.

## Alternatives considered

### Alt A — Keep HTTP writes for service principals (write-guard)

Rejected. A second mutation port. Allowlist of names is not policy. UI/LLM could be misconfigured onto the same routes.

### Alt B — Ingest as a service Action (`act.project`)

Rejected for this change. Actions carry submission criteria, parameter trees, and `ActionExecution`. Ingest identity is `sourceEventId`, not action idempotency. A service Action can be added later without restoring repository HTTP.

### Alt C — `/internal/v1/projections` HTTP now

Rejected. No cross-process caller. An HTTP ingest port would be a third public-ish write surface. In-process `ProjectionWriter` is enough.

### Alt D — Delete the routes instead of 405 tombstones

Acceptable later. Tombstones keep route-policy closure and give clients a stable error instead of 404.

## Migration

1. Apply `infra/sql/0017_projection_ledger.sql`.
2. Callers that used HTTP POST objects switch to `ctx.projections.projectObject` (same process) or an Action (humans).
3. Mutating Action clients send `idempotencyKey` and, when modifying existing objects, `expectedObjectVersions`.

No silent compatibility that still writes.

## Follow-up

- Remove tombstone routes once clients stop calling them.
- `registerActionType` cache vs ontology as the only ActionType source (open decision 6).
- Memory UnitOfWork clone/commit for Actions (target-state §5).
- `createObjectPlatform` Maps vs ProjectionWriter.
- EPID `createResource` is still not an HTTP admin API.
