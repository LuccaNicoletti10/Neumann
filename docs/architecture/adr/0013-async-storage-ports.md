# ADR-0013: Storage ports and their facades are async-only

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/object-repository.ts` (`ObjectRepository`, `LinkRepository`), `packages/contracts/src/v1/object-platform.ts` (`ObjectPlatform`), `packages/contracts/src/v1/knowledge-graph.ts` (`KnowledgeGraphStore`)
- Packages touched: `contracts`, `object-platform`, `knowledge-graph`, `policy-engine`

## Context

`ObjectRepository` and `LinkRepository` returned `Promise<T> | T`. The union existed so
the memory adapters could stay synchronous and so `createObjectPlatform` /
`createKnowledgeGraph` could expose a synchronous facade over them.

To collapse the union at the call site, both facades used a `syncValue()` helper,
duplicated in `packages/object-platform/src/core/sync-value.ts` and
`packages/knowledge-graph/src/core/sync-value.ts`:

```ts
const rec = syncValue(objects.getById(id), 'objects.getById');
```

When a PostgreSQL repository was injected, this was a ghost write. `objects.getById(id)`
had already been dispatched; `syncValue` then threw *after* the operation was in flight.
For a write (`objects.create`, `links.delete`) the transaction proceeded in the database
while the caller saw an exception, and the orphan promise rejected with nobody attached.
The type system said "fails closed"; the database said otherwise. This also made the two
adapters semantically different: memory threw synchronously, PostgreSQL rejected.

## Decision

**A — async-only ports and async facades.**

- `ObjectRepository` and `LinkRepository` methods return `Promise<T>`. The
  `Promise<T> | T` union is removed from the contract.
- The memory adapters (`createMemoryObjectRepository`, `createMemoryLinkRepository`) are
  `async`. They stay deterministic and in-process; only the signature changes.
- `ObjectPlatform` and `KnowledgeGraphStore` are async interfaces. `createObjectPlatform`
  and `createKnowledgeGraph` `await` the ports instead of collapsing them.
- `syncValue` / `isThenable` are deleted from both packages. No sync bridge over a storage
  port may return, in either package.
- Mapping-registry reads on `ObjectPlatform` (`createMapping`, `commitMapping`,
  `getMappingVersion`, `toRecursiveCteSql`) stay synchronous: they read mapping state the
  facade owns, not a storage port.

Alternative B (restrict the factories by type to synchronous memory repositories) was
rejected: it freezes the facades as test-only and leaves two shapes of the same port in
`contracts`, which the constitution forbids ("um conceito = uma API pública").

## Consequences

### Positivas

- One port shape. A memory adapter and a PostgreSQL adapter are substitutable; a caller
  cannot observe which one it holds.
- Rejection is the only failure mode, so a failure can no longer arrive after the write
  started. Ghost writes are impossible by construction, not by discipline.
- The compiler finds the callers: an un-awaited port call is a type error, not a
  `Promise<T>` silently flowing into a boolean.

### Negativas / custo

- Every facade caller becomes async. `runDemo` / `runCommandLine` in `object-platform`
  and `knowledge-graph`, and `runClassificationPipeline` in `policy-engine`, now return
  promises.
- Memory tests that asserted a synchronous `expect(() => …).toThrow()` on a repository
  must assert `await expect(…).rejects.toThrow()`.

### Invariantes que os testes devem provar

- A deferred (promise-returning) repository driven through `createObjectPlatform`
  performs each write exactly once and leaves no partial state when the facade denies.
- The facade decides authorization before it dispatches a write, so a deny reaches zero
  repository writes.
- No unhandled rejection escapes a facade call.

## Static gate

`scripts/tooling/storage-kernel.mjs` fails `pnpm verify:lint` when any
`packages/*/src/**/*.ts` file contains `syncValue(`, `function syncValue`, or
`function isThenable`. The pattern cannot return without deleting the gate, and the gate
has its own tests in `scripts/tooling/storage-kernel.test.mjs`.

## Migration

No SQL change. Callers of `ObjectPlatform` / `KnowledgeGraphStore` must `await`.
