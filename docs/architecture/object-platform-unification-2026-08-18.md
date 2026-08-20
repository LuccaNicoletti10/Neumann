# Object Platform unification — 2026-08-18

Prompt 06. ADR-0007 (accepted).

**VERDE** — objects, links, history and versions exist only in the canonical repositories used by `PlatformContext`. Facades and query surfaces are projections or mapping registries, not parallel stores.

## Ownership

| Superfície | Antes | Depois |
|---|---|---|
| `createObjectPlatform` | Maps `indexByPk` / objects / history / provenance / links + mapping Maps | Mapping Maps only (`mappings`, `mappingVersions`, `drafts`). Writes: `ObjectRepository` / `LinkRepository` / `ObjectHistoryStore`. Async repo injection fail-closed. |
| `createKnowledgeGraph` | Maps `GraphObject` / `TypedLink` | Same repositories (injected or constructed). Tickets remain process-local. Traversal working sets are ephemeral. |
| `GraphQueryEngine` | already repo-backed | unchanged (`PlatformContext.graph`) |
| `createQueryEngine` | private `createKnowledgeGraph` + dual-write of search docs | `docs` / `inverted` / `searchLinks` as search projection only; no KG import |
| `scripts/demo-sales-gd.ts` | platform → copy loop → second KG | one `objects`/`links`/`history` shared by platform + KG |
| `classification-pipeline` | `createKnowledgeGraph()` with internal Maps | same factory; factory now constructs memory repos |
| CLI `obj` / `kg` | owned Maps via factories | factories construct repos internally |
| `PlatformContext` | already repositories | unchanged; `ObjectReader`/`LinkReader` re-exported |

Identity: `ontologyId + objectTypeId + primaryKey`. Opaque `id` is a handle (`CreateObjectInput.id` / `CreateLinkInput.id` optional).

Maps of objects/links remain **only** in `createMemoryObjectRepository` / `createMemoryLinkRepository`.

## Factories

| Factory | Destino |
|---|---|
| `createObjectPlatform` | kept — stateless mapping + project adapter |
| `createKnowledgeGraph` | kept — write-through / read-through adapter |
| `createQueryEngine` | no KG; search projection only |
| `createMemoryObjectRepository` / `createMemoryLinkRepository` | canonical memory adapters |
| `createPgObjectRepository` / `createPgLinkRepository` | canonical PG adapters |

Nenhuma factory de store legado foi apagada do contrato; o estado paralelo foi removido.

## Callers migrados

| Caller | Mudança |
|---|---|
| `packages/query-api/src/core/engine.ts` | remove `createKnowledgeGraph`; `searchAround` walks `SearchLink`s |
| `packages/query-api/package.json` | drop `knowledge-graph` |
| `scripts/demo-sales-gd.ts` | repos partilhados; copy loop apagado |
| `packages/policy-engine/src/core/classification-pipeline.ts` | factory agora repo-backed |
| `packages/object-platform/src/cli.ts` | factory sem Maps de objects/links |
| `packages/knowledge-graph/src/cli.ts` | idem |
| `packages/platform-api/src/core/context.ts` | reexport `ObjectReader` / `LinkReader` |

## Interfaces de capacidade

```
ObjectReader  = get | getById | list
ObjectWriter  = create | update | delete
LinkReader    = listFrom | listTo
LinkWriter    = create | delete
```

Aliases em `packages/contracts/src/v1/object-repository.ts`. HTTP público / query: readers + Actions. ProjectionWriter / ActionExecutor: writers via UoW. Sem wrappers que só renomeiam.

## Contract suite

Mesmos casos/dados em memória e PostgreSQL (`packages/object-platform/tests/storage-contract.ts`):

- create duplicado
- update/delete CAS (`VersionConflictError`)
- history / asOf
- link existence / cardinality (`LinkIntegrityError`)
- governação (`createGovernedObjectRepository`)
- UoW commit / rollback
- ordenação / paginação
- not-found / hidden-miss
- version increment
- PG `reopen()` (restart) — só no adapter durável

Harness: `storage-contract.test.ts` (memory + fail-closed async facade) e `storage-contract.integration.test.ts` (schema isolado, UoW no client de tx).

## Paridade memory / PG

Única diferença permitida: durabilidade física (restart). Memory omite `reopen`. Governação no `PlatformContext` memory continua **não** wrapping `createGovernedObjectRepository` por omissão (decisão 7); a suite envolve os dois adapters.

## Testes (provas 1–10)

| # | Onde |
|---|---|
| 1 ProjectionWriter → todos os leitores | `platform-api/tests/single-storage.test.ts` |
| 2 Action update → ObjectSet / Graph / Explore / history | idem |
| 3 delete some; history permanece | idem |
| 4 CAS um vencedor | `storage-contract.ts` + single-storage |
| 5 links/cardinality memory=PG | contract suite nos dois adapters |
| 6 UoW failure restaura leitores | single-storage + contract suite |
| 7 restart PG preserva versões | `storage-contract.integration.test.ts` `reopen` |
| 8 nenhuma cópia a sincronizar | `knowledge-graph/tests/shared-kernel.test.ts` |
| 9 suite memory/PG | `storage-contract.test.ts` + integration |
| 10 zero stores legadas em produção | `scripts/tooling/storage-kernel.mjs` via `pnpm verify:lint` |

## Coverage (ratchet, floors; nunca reduzidos)

| | statements | branches | functions | lines |
|---|---|---|---|---|
| global | 77 (era 76) | 75 | 85 | 77 (era 76) |
| knowledge-graph | 71 (era 68) | 68 | 89 (era 86) | 71 (era 68) |
| object-platform | 60 (era 54) | 73 (era 72) | 77 (era 72) | 60 (era 54) |

Medido (verify:coverage desta sessão): global 77.13%; knowledge-graph 71.93 / 68.32 / 89.36 / 71.93; object-platform 60.42 / 73.61 / 77.52 / 60.42.

## Comandos / exits

Sem retry, sem skip. `verify:all` inclui lint/typecheck/unit/coverage/integration/build (não inclui `db:migrate` nem os `gate:*`).

| comando | exit | skips |
|---|---|---|
| `pnpm verify:lint` | 0 | 0 (16 tooling tests) |
| `pnpm verify:typecheck` | 0 | — |
| `pnpm verify:unit` | 0 | 0 (1368 passed, 214 files) |
| `pnpm verify:coverage` | 0 | 0 (`problems: []`) |
| `pnpm db:migrate` | 0 | — |
| `pnpm verify:integration` | 0 | 0 (43 passed, 20 files) |
| `pnpm verify:build` | 0 | — |
| `pnpm gate:core` | 0 | 0 |
| `pnpm gate:platform` | 0 | 0 |
| `pnpm gate:objectset-parity` | 0 | 0 |
| `pnpm verify:all` ×1 | 0 | 0 |
| `pnpm verify:all` ×2 | 0 | 0 |

## Arquivos

- `packages/contracts/src/v1/object-repository.ts`, `packages/contracts/src/v1/index.ts`, `packages/contracts/tests/object-repository.test.ts`
- `packages/object-platform/src/core/{platform,object-repository,link-repository,object-history-store,pg-object-repository,sync-value}.ts`
- `packages/object-platform/tests/{storage-contract.ts,storage-contract.test.ts,storage-contract.integration.test.ts}`
- `packages/knowledge-graph/src/core/{store,sync-value}.ts`, `packages/knowledge-graph/tests/shared-kernel.test.ts`
- `packages/query-api/src/core/engine.ts`, `packages/query-api/package.json`
- `packages/platform-api/src/core/context.ts`, `packages/platform-api/tests/single-storage.test.ts`
- `packages/policy-engine/src/core/classification-pipeline.ts`
- `scripts/demo-sales-gd.ts`, `scripts/tooling/storage-kernel.mjs`, `scripts/tooling/storage-kernel.test.mjs`, `scripts/verify-lint.mjs`
- `docs/architecture/adr/0007-single-object-storage-kernel.md`
- `docs/architecture/current-state.md`
- `docs/quality/coverage-thresholds.json`

`packages/connector-webhook/tsconfig.json` SHA inalterado:
`3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

## Débitos

- `createObjectPlatform` permanece (mapping registry). Mapping Maps não são object storage.
- Search index (`query-api`) continua projeção de `SearchDocument`s — APIs de query não consolidadas (fora de escopo).
- Tickets de remote-ref no KG são process-local.
- Explore `catalogFromRepos` materializa snapshot por pedido (projeção de leitura).
- Memory `PlatformContext` ainda sem `createGovernedObjectRepository` por omissão (decisão 7).
- `LinkRepository.bind` no context postgres ainda usa `rawObjects.get` para `objectExists` (existence ignora o decorator governed).
- Tombstones HTTP 405, ontology drafts, `projection.applied`: fora de escopo.
