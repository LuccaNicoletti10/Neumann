# Baseline hardening — 2026-08-17 (Prompt 01B.1)

Evidência **depois** de eliminar os três resíduos do Prompt 01B. Não substitui `docs/quality/baseline-2026-08-17.md` nem `docs/quality/baseline-fixes-2026-08-17.md`.

Runtime: Node **v24.19.0**, pnpm 10.20.0, `DATABASE_URL=postgres://neumann:***@127.0.0.1:55432/neumann`. Sem retry nas execuções da tabela de estabilidade.

SHA `packages/connector-webhook/tsconfig.json` (início = fim):

`3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

## 1. Causas raiz

### 1.1 `gate:platform` flaky — catalog `< 100ms`

O limite era um **proxy de wall-clock** para “GIN foi usado”. O `EXPLAIN` em texto fazia `toMatch(/index|bitmap|gin|trgm|tsvector/i)`, que casa com **qualquer** `Index Scan`.

Plano real observado (`EXPLAIN (FORMAT JSON)`) para `compileCatalogSearch` com `ontologyId` e `OR ILIKE|tsvector`:

- `Index Scan` em `platform_objects_ontology_id_object_type_id_primary_key_key` (btree), `Index Cond: ontology_id = …`, Filter com ILIKE/tsquery.
- **Não** usava GIN. O assert `< 100ms` media esse btree+filter em 100k linhas e falhava sob carga (105ms vs 100ms).

Causa estrutural extra: `OR` de `ILIKE '%…%'` (sem `pg_trgm` visível no schema isolado) com `@@ tsvector` impede o planner de escolher `platform_objects_props_fts`. Isolado: `search_path` só no schema de teste → `gin_trgm_ops` invisível → `platform_objects_pk_trgm` não é criado na migration 0013.

Não se alargou o limite, não houve retry/sleep/`|| true`.

### 1.2 Worker: exit genérico → `FORBIDDEN_API`

Depois do 01B, timeout deixou de ser `MEMORY_LIMIT`, mas **qualquer exit ≠ 0 sem OOM** virava `FORBIDDEN_API`. Exit code não é evidência de API proibida. `require('fs')` e um crash do isolate eram indistinguíveis.

### 1.3 `verify:unit` coletava integrações para skip

`turbo run test` executava `vitest run` por package, que inclui `*.integration.test.ts`. Sem `DATABASE_URL`, `describe.skipIf(!db)` saía 0 com skips. Unit e integration não eram partição; o skip era o mecanismo de partição.

`it.skipIf` do age CLI em `security-config-secrets` era um skip residual em unitários.

## 2. Invariantes implementados

| Invariante | Onde |
|---|---|
| Plano de catalog é GIN estrutural, não tempo | `inspectCatalogPlan` / `verdictForCatalogPlan` sobre `EXPLAIN (FORMAT JSON)` |
| Positivo: FTS GIN; negativo: PK btree | `catalog.integration.test.ts` + fixtures em `catalog-plan.test.ts` |
| Resultado da search endereça a linha | `primary_key` contém `000042` |
| Primeiro evento causal do Worker vence | `bindWorkerTerminal` + `createOnceSettler` |
| Exit isolado ≠ OOM ≠ forbidden API | `classifyWorkerTermination` → `EXECUTION_ERROR` |
| `ALL_TESTS = UNIT ∪ INTEGRATION`, interseção vazia | `scripts/test-discovery.mjs` |
| Unit não coleta integration; zero skips | `verify:unit` |
| Integration descobre `*.integration.test.ts`; zero skips; ficheiro em falta falha | `verify:integration` + `run-vitest-files.mjs` |

O `< 100ms` **não** era um SLO. Não foi promovido a benchmark (não há ambiente/SLO registado). Warm-up/p50/p95 ficam como débito se alguém declarar latência como contrato.

## 3. Plano GIN validado

Índices vivos no schema isolado (pg_catalog): `platform_objects_props_fts` (gin), `platform_objects_props_gin` (gin jsonb), btrees de PK/unique/type. Sem `platform_objects_pk_trgm` (operator class fora do `search_path`).

`compileCatalogSearch` passou a **UNION** (ILIKE ∪ tsvector). O braço FTS é indexável por `platform_objects_props_fts`. Callers não parseiam JSON: `inspectExplainedCatalogQuery` devolve `CatalogPlanVerdict`.

Positivo (query compilada, `q = zxqv42unique`): `usedGin === true`, `ginIndexesUsed` contém `platform_objects_props_fts`.

Negativo (`WHERE id = $1`): `usedGin === false`, `otherIndexesUsed` contém `platform_objects_pkey`.

Fixtures unitárias cobrem Bitmap Index Scan GIN, Index Scan btree e Seq Scan sem PostgreSQL.

## 4. Matriz terminal do Worker (ADR-0002)

Contrato: `SandboxDenyReason` += `EXECUTION_ERROR`. `CANCELLED` fica no runner.

| Evidência | Resultado |
|---|---|
| Timer iniciou encerramento | `TIMEOUT` |
| `ERR_WORKER_OUT_OF_MEMORY` | `MEMORY_LIMIT` |
| `detectForbiddenApi` (require/import) | `FORBIDDEN_API` |
| `AbortSignal` | `CANCELLED` (runner) |
| `error`/`exit` sem causa prévia | `EXECUTION_ERROR` |
| `message` ok | sucesso |

Eventos tardios: `createOnceSettler`; listener `error` no-op após settle (EventEmitter não relança). Timer/listeners limpos.

Testes: sucesso, timeout, OOM, forbidden API, crash (`exit` sem message), cancelamento, settle único, evento tardio (`tests/worker-runner.test.ts` 19 + `gates.test.ts` isolation).

## 5. Partição UNIT / INTEGRATION

Fonte única: `scripts/test-discovery.mjs`. `verify:unit` e `verify:integration` não duplicam globs.

```
total = 216
UNIT = 199
INTEGRATION = 17
unclassified = 0
UNIT ∩ INTEGRATION = ∅
216 = 199 ∪ 17
```

Integration (descoberta dinâmica, não lista hardcoded):

- `apps/erp-simulator/tests/closed-loop.integration.test.ts`
- `packages/action-engine/tests/pg-durability.integration.test.ts`
- `packages/entity-resolution/tests/pg-ledger.integration.test.ts`
- `packages/event-bus/tests/outbox-reliability.integration.test.ts`
- `packages/event-bus/tests/outbox-worker.integration.test.ts`
- `packages/event-bus/tests/pg-outbox-canonical.integration.test.ts`
- `packages/event-bus/tests/writeback-http.integration.test.ts`
- `packages/object-platform/tests/migrations.integration.test.ts`
- `packages/object-platform/tests/pg-concurrency.integration.test.ts`
- `packages/object-platform/tests/pg-integrity.integration.test.ts`
- `packages/object-set/tests/catalog.integration.test.ts`
- `packages/object-set/tests/parity.integration.test.ts`
- `packages/ontology-registry/tests/pg-registry.integration.test.ts`
- `packages/platform-api/tests/end-to-end.integration.test.ts`
- `packages/platform-api/tests/pg-platform-durability.integration.test.ts`
- `packages/policy-engine/tests/pg-audit.integration.test.ts`
- `packages/policy-engine/tests/pg-policy.integration.test.ts`

Pool de unit: 2 packages em paralelo (8 workers esgotavam o Vitest: timeout 5s + hang RPC `fetch /@vite/env`). Timeout de spawn 120s por package. Não é retry: é o bound de concorrência do runner.

Age CLI: deixou de ser `it.skipIf`; ausência do binário é ramo executado, não skip.

## 6. Comandos e estabilidade (Node 24, sem retry)

| Comando | N | Exit | Skips | Notas |
|---|---|---|---|---|
| `pnpm install --frozen-lockfile` | 1 | 0 | — | lockfile up to date |
| `pnpm verify:typecheck` | 1 | 0 | — | 74/74 |
| `pnpm verify:build` | 1 | 0 | — | 54/54 |
| `pnpm gate:platform` | **20/20** | 0 | — | object-set + platform-api |
| `pnpm --filter execution-sandbox test` | **20/20** | 0 | 0 | 27 tests |
| `pnpm verify:unit` | **3/3** | 0 | **0** | 199 files, 1270 passed |
| `pnpm verify:integration` | **3/3** | 0 | **0** | 17 files, 38 passed |
| `pnpm verify:all` | **2/2** | 0 | **0** | unit 1270 + integration 38 cada |

`node scripts/test-discovery.mjs`: intersection 0, unclassified 0.

## 7. Ficheiros desta fase (01B.1)

Não inclui o tsconfig protegido (já `M` antes; SHA inalterado). Não inclui `package.json` engines / compose / 01B.

- Catalog: `packages/object-set/src/core/catalog-plan.ts`, `tests/catalog-plan.test.ts`, `tests/catalog.integration.test.ts`, `src/core/search-sql.ts`, `tests/search-sql.test.ts`
- Worker: `packages/execution-sandbox/src/core/worker-runner.ts`, `src/core/sandbox.ts`, `src/worker/entry.ts`, `src/worker/forbidden-api.ts`, `tests/worker-runner.test.ts`, `tests/gates.test.ts`
- Contrato: `packages/contracts/src/v1/sandbox.ts`, `tests/sandbox.test.ts`
- ADR: `docs/architecture/adr/0002-worker-terminal-result-taxonomy.md`, `docs/architecture/adr/README.md` (próximo livre 0003)
- Descoberta: `scripts/test-discovery.mjs`, `scripts/run-vitest-files.mjs`, `scripts/verify-unit.mjs`, `scripts/verify-integration.mjs`, `scripts/run-fail-closed-vitest.mjs`
- Skip age: `packages/security-config-secrets/test/security.test.ts`
- Este relatório

## 8. SHA protegido

Inicial: `3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

Final: `3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

## 9. Débitos restantes

- `platform_objects_pk_trgm` ausente em schema isolado (`search_path` sem `public` / `gin_trgm_ops`). Catalog usa `props_fts`.
- Sem SLO de latência; wall-clock não voltou ao correctness gate.
- `run()` in-process ainda mapeia throw desconhecido para `FORBIDDEN_API` (ADR-0002 follow-up).
- `ctx.policy` (EPID) ≠ `ctx.authorizer` HTTP — fora de 01B.1.
- `gate:t1.3` e event-bus `gate` continuam memória.
- Node 26 do host Homebrew continua instalado; suportado é 24.

Sem `git commit` / `git push`.
