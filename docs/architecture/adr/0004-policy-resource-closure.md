# ADR-0004: Overlay wildcards compile to EPID; every business route declares policy

- Status: accepted
- Date: 2026-08-18
- Deciders: Neumann kernel maintainers
- Contracts touched: none (`AuthorizeRequest` / `PolicyEngine` stay v1)
- Packages touched: `policy-engine`, `platform-api`, `action-engine`, `object-platform`, `infra/sql/0016_policy_resource_namespace.sql`
- Supersedes: ADR-0003 follow-up that left overlay `*` as evaluator input (Alt B deferred)

## Context

ADR-0003 put HTTP and Actions on `PolicyRuntime`, but three fail-open surfaces remained:

1. Overlay `*` was matched at authorize time (`evaluateOverlay`) with different semantics than EPID nodes.
2. Resource IDs were unscoped (`object:ot.order`), so two ontologies could collide.
3. Ontology/render/function routes did not declare policy; `createActionExecutor` / `createObjectPlatform` defaulted to `allowAll`.

A new ObjectType could be authorized by `*` without a new generation. Routes could concatenate schemes and miss compiled nodes.

## Decision

`PolicyRuntime.authorize` calls only `engine.authorize` after `qualifyResource`. Overlay wildcards are **compile-time** input.

```
validate overlay → compileOverlayToEpid(overlay, catalog) → persist snapshot → publish generation
```

Readers observe generation N or N+1, never a hybrid. Persist/compile throw leaves the previous generation.

### Resource namespaces

`ResourceIds` is the only factory. Namespaced kinds:

```
{scheme}{encodeURIComponent(ontologyId)}/{encodeURIComponent(localId)}
```

| Kind | Builder | Example |
|---|---|---|
| object type | `ResourceIds.objectType(ontology, id)` | `object:sales/ot.order` |
| action | `ResourceIds.action(ontology, apiName)` | `action:sales/approve` |
| link type | `ResourceIds.linkType(ontology, id)` | `link:sales/lt.x` |
| function | `ResourceIds.function(ontology, id)` | `function:sales/fn.x` |
| ontology | `ResourceIds.ontology(id)` | `ontology:sales` |
| admin / render / ER | `ResourceIds.admin(name)` | `admin:render` |
| action-execution (approvals) | `ResourceIds.admin('action-execution')` | `admin:action-execution` |

Kernel-global kinds use ontology `_` (`KERNEL_ONTOLOGY`) when a namespace is required. Legacy unscoped `object:ot.order` parses as ontology `_` and is canonicalized by `qualifyResource` to `object:_/ot.order@read`.

### Catalog

`PolicyResourceCatalog` lives on the same snapshot (`policy_meta.catalog`). Kernel admin/render/ER resources are always in the catalog. Ontology publish:

```
validate → compile resources → persist → publish generation
```

A new ObjectType is unauthorized until the next compiled generation.

### Route policy

Each Fastify business route declares `{ operation, resourceResolver, hiddenMiss }`. A single `preHandler` evaluates `ctx.policy.authorize` before the handler. Public exceptions: `GET /health`, `GET /ready`, `OPTIONS`. Boot (`assertRoutePolicyClosure`) fails if a business route is unclassified or uses an unknown operation.

Write HTTP object/link routes are 405 tombstones (ADR-0005). They keep policy declarations for route-closure; handlers do not write.

### Fail-closed factories

`createActionExecutor` and `createObjectPlatform` require `authorize`. Tests inject the named fixture `createAllowAllTestPolicy` (compiled ALLOW_ALL against kernel catalog + optional types). No optional parameter silently allows all.

## Consequences

### Positivas

- One evaluator. Overlay `*` and explicit grants that cover the same catalog rows produce the same EPID decisions.
- Resource IDs cannot collide across ontologies.
- Deny is before the handler; hidden-miss is preserved.
- Production without policy fails at factory/bootstrap, not as allow-all.

### Negativas / custo

- ALLOW_ALL with an empty object/action catalog denies those resources until `publishCatalog` / ontology commit. Tests that expected `*` to mean “any string” must pass a catalog.

### Invariantes que os testes devem provar

- Negativo: `*` + empty catalog denies unknown ObjectTypes (proves compiler, not overlay eval).
- Wildcard vs explicit grants: equivalent decisions on the same catalog rows.
- New ObjectType allowed only after a new generation.
- Persist/compile failure: generation and decisions unchanged.
- Fastify enumeration: every business route has policy; no concatenated `object:` / `action:` in route sources.
- Missing `authorize` on ActionExecutor / ObjectPlatform throws.
- Concurrent readers: generation N or N+1, never mixed catalog+overlay.

## Alternatives considered

### Alt A — Keep overlay `*` at authorize time; compile only explicit names

Rejected. Two evaluators. A new ObjectType would be authorized without a generation bump.

### Alt B — Map every ObjectType to a unique EPID node at overlay write, without a catalog

Rejected. Overlay write does not have the ontology. The catalog *is* the write-time input; compile happens on publish.

### Alt C — Optional `authorize?` that defaults to deny-all

Rejected for tests that omitted the argument and looked green. Require the named fixture.

## Migration

1. Apply `0016_policy_resource_namespace.sql` (`policy_meta.catalog`; rewrite unscoped `object:` / `action:` / `link:` ids to `:_/`).
2. Restart loads overlay + catalog, recompiles `ovl-` nodes, publishes one generation.
3. Compatibility: unscoped resource strings still parse; authorize canonicalizes them. Native EPID resource ids without a scheme are unchanged.

## Follow-up

Closed by ADR-0005: public object/link writes are 405 tombstones; ingest is `ProjectionWriter`. `evaluateOverlay` / `createAllowAllAuthorizer` removed (no runtime callers).
