# ADR-0006: Durable Action execution (pinned definition, CAS envelope, paritary UoW)

- Status: accepted
- Date: 2026-08-18
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/action-runtime.ts` (`ActionDefinitionResolver`, `ResolvedActionDefinition`, envelope fields on `ActionExecution`; `ActionExecutor.registerActionType` / `getActionType` removed)
- Packages touched: `action-engine`, `object-platform`, `platform-api`, `ontology-registry` (resolver input), `infra/sql/0018_action_execution_envelope.sql`
- Closes: current-state decision 6 (ActionType only from ontology); decision 22 (failure-surviving on memory and postgres)

## Context

`ActionExecutor` kept a `Map` filled by `registerActionType`. HTTP `ensureActionType` copied the latest ontology snapshot into that Map. After pause or process restart, resume resolved **latest** again. Approval did not persist `expectedObjectVersions`, so a mutated object during the wait could still be written.

Memory Actions had no UnitOfWork. `ProjectionWriter` compensated with `ledger.abandon` and compensating deletes. PostgreSQL rolled back a transaction. The two adapters did not share an observable contract: a throw after `objects.create` left partial memory state and no durable FAILED row unless postgres wrapped `createFailureSurvivingExecutor`.

Target-state: ontology is the only ActionType source; an execution that pauses or restarts runs the pinned definition once.

## Decision

### ActionType source

`ActionDefinitionResolver.resolve(ontologyId, ontologyVersionId, actionTypeId)` is the only way the executor loads a definition. The result is a frozen `ActionTypeDef` identified by canonical hash (`hashCanonical`).

`createActionExecutor` takes `ontology: OntologyRegistry` (or an injected resolver). It does not accept `actionTypes` and does not expose `registerActionType` / `getActionType`.

On first `apply` (no resume), the executor looks up **latest once**, then persists the pin. Resume never calls latest. Missing version or hash mismatch fails closed: terminal `FAILED`, zero object/link writes, audited reason.

HTTP validate/apply/parameter-tree no longer copy types into the executor. POST `/actionTypes` writes ontology only.

### Envelope

Each `ActionExecution` persists:

```
ontologyId, ontologyVersionId, actionTypeId, actionTypeHash,
parameters, principal, idempotencyKey, expectedObjectVersions, policyGeneration
```

Migration `0018` adds nullable columns so existing rows stay readable. Resume of a row without pins fails closed (not "use latest").

`policyGeneration` is observational. Resume **reauthorizes** the original principal against live policy. A revoked grant is `DENIED` with zero writes. A generation bump alone is not a failure.

### State machine

Transitions live in one table (`action-lifecycle`). Existing status names are unchanged.

```
PENDING → AUTHORIZED | DENIED | FAILED
AUTHORIZED → VALIDATED | DENIED | FAILED
VALIDATED → RUNNING | AWAITING_APPROVAL | FAILED
AWAITING_APPROVAL → RUNNING | REJECTED | DENIED | FAILED
RUNNING → SUCCEEDED | FAILED
SUCCEEDED | FAILED | DENIED | REJECTED → ∅
```

Invariants: only listed edges; terminal never leaves; approval write-back starts only from `AWAITING_APPROVAL`; concurrent approvers compete on CAS `AWAITING_APPROVAL → RUNNING`; the loser does not run rules and returns the persisted result; duplicate idempotency returns the stored execution.

The prompt phrase “CAS pending → running” maps to **`AWAITING_APPROVAL → RUNNING`**, not the `PENDING` status (that is the pre-authorize claim).

### Approval resume

1. Authenticate the approver (`ResourceIds.admin('action-execution')`).
2. Reauthorize the original principal on the action with current policy.
3. `resolve` the pinned version; hash must match the envelope.
4. Revalidate submission criteria against live objects.
5. Compare envelope `expectedObjectVersions` to live versions.
6. CAS `AWAITING_APPROVAL → RUNNING`.
7. UnitOfWork: rules + events + outbox + audit.
8. Persist terminal.

Object changed during the wait: `FAILED` conflict/stale, zero writes, zero side effects, audited. Two approvers: one write-back. Reject is terminal.

`AWAITING_APPROVAL` is a committed apply result (envelope durable), not a rollback.

### UnitOfWork parity

PostgreSQL: `txManager.transaction` binds tx-scoped stores (unchanged).

Memory: snapshot/restore of objects, links, history, events, outbox, execution store, projection ledger. Callers do not see the journal. `ProjectionWriter` no longer compensates with `abandon` / compensating delete; it requires a UnitOfWork.

The FAILED/DENIED execution row that must survive a rolled-back attempt is written on the **root** store after the transaction, via `createFailureSurvivingExecutor`, on both memory and postgres.

## Consequences

### Positivas

- Pause/restart cannot apply an ActionType that was not pinned.
- Approval cannot skip CAS versions.
- Memory injected failure restores every listed store, matching PG rollback.
- One public API for ActionType: ontology.

### Negativas / custo

- Tests and CLI must commit ActionTypes on an `OntologyRegistry` (no Map seed).
- Pre-0018 execution rows cannot be approved; they fail closed until replayed as new applies.
- Ontology drafts remain session-local on PG (current-state decision 17); a pin to a committed version is durable.

### Invariantes que os testes devem provar

- ActionType is resolved from ontology; there is no register cache.
- Changing latest after pause does not change the pending execution's rules.
- Divergent hash fails closed, zero writes.
- Envelope CAS versions survive PG restart.
- Object mutated during approval → conflict, zero writes.
- Two concurrent approvers → one write-back.
- Duplicate idempotencyKey → same persisted result.
- Policy revoked during wait → DENY, zero writes.
- Precondition changed during wait → fail, no effects.
- Injected throw reverts objects/links/history/events/outbox/ledger/executions.
- FAILED record survives on the root store when required.
- Memory and PG share the observable contract for the cases above.
- ProjectionWriter memory uses UoW, not compensating delete.
- PG restart preserves state machine + envelope.

## Alternatives considered

### Alt A — Keep `registerActionType` as a write-through cache of latest

Rejected. A cache that can be stale or newer than the pin is a second source of truth. HTTP already had `ensureActionType` copying latest on every call.

### Alt B — Persist the full ActionTypeDef JSON on the execution row instead of hash + version id

Rejected. Ontology version is already the immutable snapshot. Duplicating the def makes the execution a third ontology. Hash detects tampering and migration drift; `getVersion` is the loader.

### Alt C — Memory compensating deletes (keep ProjectionWriter `abandon`)

Rejected. Compensation is not the inverse of an arbitrary throw (partial history, events, outbox). Snapshot/restore is the memory analogue of ROLLBACK.

## Migration

1. Apply `0018` (nullable columns).
2. Deploy executor that writes the envelope on claim/save.
3. Resume without pins fails closed — operators replay those Actions.
4. Remove `registerActionType` call sites in the same change (no dual-write window).

## Follow-up

- Decision 17: durable ontology drafts.
- Tombstones, ontology admin HTTP, and `projection.applied` handlers stay out of this ADR (Prompt 04 leftovers).
- `createObjectPlatform` Maps projector (decision 2) unchanged.
