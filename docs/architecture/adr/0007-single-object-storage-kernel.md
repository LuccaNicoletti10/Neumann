# ADR-0007: Uma única Object Platform (repositórios canônicos)

- Status: accepted
- Date: 2026-08-18
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/object-repository.ts` (capability aliases; optional `id` on create inputs; optional `provenance` on `UpdateObjectInput`)
- Packages touched: `object-platform`, `knowledge-graph`, `query-api`, `policy-engine`, `platform-api`, `scripts/demo-sales-gd.ts`
- Closes: current-state decisions 2 (partial — projector Maps) and 3 (KG Maps); graph/query read the same repositories

## Context

`PlatformContext` already persisted objects/links in `ObjectRepository` / `LinkRepository`. In parallel:

- `createObjectPlatform` owned `Map`s of `OntologyObject` / links / history.
- `createKnowledgeGraph` owned `Map`s of `GraphObject` / `TypedLink`.
- `createQueryEngine` defaulted to a private KG and dual-wrote search documents into it.
- `scripts/demo-sales-gd.ts` copied platform objects into a second KG.

Readers (ObjectSet, `GraphQueryEngine`, Explore `catalogFromRepos`, history) could disagree with those Maps. Dual-write and “sync the copy” were the failure mode.

Target-state: repositories are the only live object/link state. Graph / ObjectSet / Explore / search are read projections.

## Decision

### Storage kernel

Authoritative identity is `ontologyId + objectTypeId + primaryKey`. Opaque `id` is a handle, not a second identity.

Live state exists only in:

- `ObjectRepository`
- `LinkRepository`
- `ObjectHistoryStore`
- `OntologyRegistry`
- `UnitOfWork` (memory snapshot or PG transaction)

Maps of objects/links are allowed only inside the canonical memory adapters (`createMemoryObjectRepository`, `createMemoryLinkRepository`).

### `createObjectPlatform`

Remains as a **stateless mapping + project facade**. It does not own object/link/history Maps. It creates or receives canonical repositories and writes through them (`create`/`update`/`links.create`/`history.append`).

Mapping version Maps stay inside the facade (mapping registry is not object storage).

If a caller injects an async (PG) repository into this sync facade, it fails closed. PostgreSQL ingestion uses `ProjectionWriter` + UoW.

Optional `CreateObjectInput.id` / `CreateLinkInput.id` are additive so graph/CLI can preserve explicit handles without a parallel id index.

### `createKnowledgeGraph`

Receives (or constructs) the same repositories. `upsertObject` / `upsertLink` write through. `get` / `list` / `traverse` / `checkIntegrity` read through. Tickets for remote refs remain process-local (not object storage).

`GraphQueryEngine` is unchanged: read-only over repositories. It is `PlatformContext.graph`.

### query-api

Search documents + inverted index remain a **search projection** (not an object store). The engine no longer constructs or dual-writes a `KnowledgeGraphStore`. Graph-backend `searchAround` walks `SearchLink`s recorded in the index.

### Capabilities

```
ObjectReader  = get | getById | list
ObjectWriter  = create | update | delete
LinkReader    = listFrom | listTo
LinkWriter    = create | delete
```

Public HTTP already sees readers + Actions (`PublicPlatformContext`). Query services take readers. Writers stay on `PlatformContext` / UoW.

### Parity

A contract suite runs the same cases against memory and PostgreSQL. The only allowed difference is physical durability (restart).

## Consequences

### Positivas

- One object seen by ProjectionWriter, Actions, ObjectSet, Graph, Explore, history.
- CLI/demo cannot drift from kernel storage.
- Static gate fails production copies of object/link Maps and query-api→KG dual-write.

### Negativas / custo

- `createObjectPlatform` is still a mapping registry (not removed).
- Search index is still a projection copy of `SearchDocument`s (query APIs not consolidated — out of scope).
- Memory `PlatformContext` still does not wrap `createGovernedObjectRepository` by default (decision 7); the contract suite does wrap both adapters.
- Explore `catalogFromRepos` still materializes a per-request snapshot (read projection, not a store).

### Invariantes que os testes devem provar

- ProjectionWriter create is visible to ObjectSet / Graph / Explore / history.
- Action update is visible to the same readers.
- Delete hides from live readers and remains in history.
- Concurrent CAS: one winner.
- Links/cardinality equal on memory and PG.
- UoW throw restores all readers.
- PG restart preserves versions.
- Zero production Maps of objects/links outside canonical adapters.
- Contract suite passes on both adapters.

## Alternatives considered

### Alt A — Keep Maps and sync them after each write

Rejected. Synchronization is a second source of truth. It fails under concurrency and restart.

### Alt B — Delete `ObjectPlatform` / `KnowledgeGraphStore` contracts in this change

Rejected. Query APIs are out of scope. Facades stay as adapters over the kernel.

## Migration

1. Repositories grow optional create `id` (additive).
2. Facades drop object/link Maps in the same change (no dual-write window).
3. query-api stops importing `createKnowledgeGraph`.
4. Callers pass the same repository instances (demo-sales).
5. Static gate on production src.

## Follow-up

- Decision 7: governed wrapper on default memory `PlatformContext`.
- Consolidate query surfaces (ObjectSet / graphPatterns / query-api / explore catalog).
- Remove mapping facade once dataset projection is only `ProjectionWriter`.
