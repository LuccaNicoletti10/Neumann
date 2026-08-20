# ADR-0015: An object changes OntologyVersion only through a declared migration

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/projection.ts` (`MigrateObjectCommand`, `ProjectionOperation.migrate_object`, `ProjectionWriter.migrateObject`), `packages/contracts/src/v1/object-repository.ts` (`UpdateObjectInput.migrateToOntologyVersionId`)
- Packages touched: `object-platform`, `platform-api`
- Migration: `infra/sql/0021_object_version_migration.sql`

## Context

ADR-0014 makes the version stamped on a record the schema of record. That leaves one
question open: how does a record legitimately move to a newer version? Before this ADR
there was no answer, so the only ways to move an object were to re-stamp it silently
inside a write path, or to leave it on its original version forever.

Neither is acceptable. A silent re-stamp changes the schema of live data with no
authorization, no CAS and no trail, and history would then claim a state the
transformation never produced.

## Decision

**Migration is a command, not a repository write.** `ProjectionWriter.migrateObject`
is the only path, and `UpdateObjectInput.migrateToOntologyVersionId` is the only field
that re-stamps `record.ontologyVersionId`. There is no public direct write.

```ts
interface MigrateObjectCommand {
  ontologyId; objectTypeId; primaryKey;
  fromVersionId; toVersionId;
  expectedObjectVersion;          // CAS, required
  transformedProperties;          // full property set valid under toVersionId
  principal; idempotencyKey;
  observedAt?; provenance?;
}
```

Semantics, all inside one transaction:

1. Authorize as `modify` — migration rewrites an existing object.
2. Refuse `fromVersionId === toVersionId`.
3. Both versions must exist and belong to the ontology, checked before the write.
4. The declared `fromVersionId` must equal the stamped version, else
   `OntologyVersionMismatchError` naming both.
5. CAS on `expectedObjectVersion` is mandatory. A stale value is `VersionConflictError`.
6. `transformedProperties` is validated in full against `toVersionId`. A breaking target
   with no transformation fails: the object is untouched, at its old version.
7. On success: `ontologyVersionId` becomes `toVersionId`, object `version` increments,
   history records the snapshot with `fromOntologyVersionId` / `toOntologyVersionId`,
   and audit, operational event and outbox are written with the same effects as any other
   governed mutation.
8. `idempotencyKey` is the replay identity, through the projection ledger: identical
   replay returns the stored result and writes nothing; the same key with a divergent
   payload is a conflict and writes nothing.
9. Any failure rolls back every store in the unit of work.

A migration is never batched with unrelated effects and never created implicitly: a
missing object is `ObjectNotFoundError`, not a create.

## Consequences

### Positivas

- The version of an object is auditable: `platform_object_history` states that a move
  happened and between which two versions, so "migrated" is a fact, not an inference from
  adjacent rows.
- Two concurrent migrations of the same object leave exactly one winner, memory and PG.
- A breaking change cannot be applied by retrying: it needs a transformation per object.

### Negativas / custo

- Migrating a population is N authorized transactions. There is no bulk re-stamp, by
  design; a bulk verb would be a second write path.
- The caller must supply the full transformed property set, including values the source
  version never carried.

### Invariantes que os testes devem provar

- Additive v1→v2 passes; breaking v1→v3 without the new value fails and leaves the object
  at v1 with its original object version.
- The same migration with the value supplied passes and stamps v3.
- History carries `fromOntologyVersionId` and `toOntologyVersionId`.
- Identical replay is idempotent (no second history row); divergent payload conflicts.
- Concurrent migration: one winner, one `VersionConflictError`.
- PG restart preserves the stamped version and the migration history rows.
- Rolling `latest` back does not un-migrate a migrated object.

## Alternatives considered

### Alt A — expose `objects.update({ migrateTo })` publicly

Rejected: it puts a schema decision on the storage port, so any caller with a repository
handle could re-stamp a record outside authorization and audit. It also adds a second
mutation door, which the constitution forbids.

### Alt B — automatic migration when the change is `additive-compatible`

Rejected: "additive" describes the schema, not the data. An automatic sweep would touch
rows nobody asked to touch, produce history entries with no principal, and make the moment
of migration depend on when a row happened to be read.

### Alt C — a dedicated administrative Action instead of a Projection capability

Not rejected as a concept — an administrative Action can call this capability. The
capability itself must exist at the projection layer because it is a transactional storage
operation; putting the transaction inside an ActionType would duplicate the unit of work.

## Migration

`infra/sql/0021_object_version_migration.sql` adds `from_ontology_version_id` and
`to_ontology_version_id` to `platform_object_history`, plus a partial index over migrated
rows only. Append-only: no existing migration file changes. Plain updates leave both
columns NULL.

## Follow-up

No administrative ActionType ships with the kernel; `apps/` declares one if it needs a
human-facing migration verb. Bulk migration orchestration (batching, resume, progress) is
out of scope and is not a kernel concern.
