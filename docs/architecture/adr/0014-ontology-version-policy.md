# ADR-0014: One authority decides which OntologyVersion validates an operation

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/object-repository.ts` (`UpdateObjectInput.ontologyVersionId`)
- Packages touched: `object-platform` (`ontology-version-policy`, `ontology-compatibility`, `governed-object-repository`, `projection-writer`), `platform-api` (context wiring)

## Context

Three modules answered "which OntologyVersion governs this write?" independently:

- `createGovernedObjectRepository` took a `resolveVersion` callback with its own TTL cache.
- `createProjectionWriter` called `getLatestVersion` per operation and validated payload
  properties against that snapshot.
- `ActionExecutor` resolved the ActionType from its own cache.

The answers diverged. Concretely, `ProjectionWriter.projectObject` validated an **update**
against `latest`, while the governed repository validated the same write against the
version stamped on the record. Publishing a version therefore changed the schema of live
objects on one path and not on the other: after publishing a v3 that required a new
property, updating an untouched v1 object failed with `property "code": required` — an
implicit migration by validation, on a row nobody had migrated.

## Decision

**`OntologyVersionPolicy` is the single authority.** One port, one question:

```ts
interface OntologyVersionPolicy {
  pin(request: OntologyVersionPin): Promise<PinnedOntologyVersion>;
}
```

Three pin kinds, and no others:

| kind | governing version |
|---|---|
| `create` | the caller's explicit `ontologyVersionId`, else `latest` resolved once at operation start |
| `mutate` | the version stamped on the record. A caller-declared `requested` version that differs is carried as `divergentRequest`, never substituted |
| `migrate` | the declared `to`; the declared `from` must equal the stamped version, or `OntologyVersionMismatchError` |

Consequences of the decision, in the runtime:

- Publishing a version migrates nothing. Rolling `latest` back rewrites nothing.
- A plain update validates against the object's own version, so a v2-only property on a
  v1 object fails, and an Action pinned to v2 cannot write a v2 field on a v1 object.
  The error names the object version, the requested version and the incompatibility
  (`OntologyVersionMismatchError`).
- `ProjectionBatch` pins once and carries that version for the whole transaction.
- No caller calls `getLatestVersion()` mid-operation.
- **Property validation belongs to the governed repository**, which is the only layer
  that has read the row and therefore knows the version of record. `ProjectionWriter`
  validates only what the pin can decide without the row: the object type exists, and
  link type / endpoints / cardinality.

`classifyOntologyChange(from, to)` classifies a version pair as
`additive-compatible | coercible | breaking | invalid` from the diff alone: pure,
deterministic, direction-sensitive. It never triggers a migration; it reports whether one
is needed. A breaking change is never migrated automatically.

## Consequences

### Positivas

- "An object never changes schema implicitly" is enforced in one place instead of being
  re-derived by each caller.
- A version violation is reportable: both versions and the specific incompatibility are
  in the error, instead of a bare "property not declared".
- Compatibility is a pure function of two versions, so it can be evaluated before
  publishing without touching data.

### Negativas / custo

- `ProjectionWriter` no longer rejects an invalid payload before opening the transaction
  for property violations; the governed repository rejects it inside, and the unit of work
  rolls back. Zero side effects still holds, but the ledger claim is made and rolled back
  rather than never made.
- Every memory test fixture now needs a version authority, so a governed repository
  cannot be built from a bare callback.

### Invariantes que os testes devem provar

- An object created under v1 stays v1 after v2 is published, and after `latest` is rolled
  back to v1 while it sits on v3.
- A plain update of a v1 object validates against v1; a v2-only property fails.
- An Action pinned to v2 acting on a v1 object fails explicitly.
- One `getLatestVersion` per batch, not one per effect.
- Classification is deterministic and asymmetric; a mixed change reports the worst class.

## Alternatives considered

### Alt A — keep `resolveVersion` per module, document the intended semantics

Rejected: it is what produced the divergence. A convention that three modules must
re-implement is not an invariant.

### Alt B — always validate against `latest`

Rejected: it is an implicit migration. Publishing a version would break live objects that
nobody chose to move, which is precisely what this ADR forbids.

### Alt C — stamp every object with `latest` on each write

Rejected: silent re-stamping rewrites the schema of record with no audit trail and no
transformation, so history would claim a migration that never ran.

## Migration

No SQL change here (migration history lives in ADR-0015). Callers that built a governed
repository with `resolveVersion` pass a `versionPolicy` instead.

## Follow-up

`ActionExecutor` resolves its ActionType through the pinned version; the executor's own
`registerActionType` cache remains a separate open item in
[`../current-state.md`](../current-state.md).
