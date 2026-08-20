# Correções da baseline — 2026-08-17 (Prompt 01B)

Evidência **depois** das correções de tooling/runtime. Não substitui `docs/quality/baseline-2026-08-17.md`.

Logs: `/tmp/neumann-01b/`. Commit de trabalho ainda `112cf8a` (sem commit desta fase).

## 0. Runtime

| Item | Valor |
|---|---|
| Node | **v24.19.0** (instalado via nvm nesta sessão; o host estava em v26.3.1) |
| pnpm | 10.20.0 |
| `DATABASE_URL` (redacted) | `postgres://neumann:***@127.0.0.1:55432/neumann` |
| Volume do utilizador | `neumann_neumann_pg` **não** apagado |

Node 24 **não** estava instalado no início. Não se enfraqueceram testes para passar no 26. ADR: `docs/architecture/adr/0001-supported-node-runtime.md`.

SHA `packages/connector-webhook/tsconfig.json` (início = fim):

`3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

## 1. Causas raiz das cinco classes

### 1.1 execution-sandbox `MEMORY_LIMIT` vs `TIMEOUT`

`worker.terminate()` no timer produzia `exit` ≠ 0. O handler classificava **qualquer** código ≠ 0 como `MEMORY_LIMIT` e o `finish` inicial ganhava a corrida contra o `TIMEOUT`.

Correção: classificar por causa. Timeout iniciado → `TIMEOUT`. `MEMORY_LIMIT` só com `ERR_WORKER_OUT_OF_MEMORY` / mensagem equivalente. Exit genérico → `FORBIDDEN_API`. Settle uma vez; eventos tardios não sobrescrevem.

Testes do worker: 5/5 runs no Node 24.

### 1.2 `gate:bloco1` argv

`pnpm --filter event-bus cli -- gate` entregava `--` como `argv[2]`. O CLI não executava `runGateScenario`.

Correção: `pnpm --filter … run cli gate` (sem `--` extra) + `parseEventBusArgs` que ignora `--` solto.

### 1.3 `gate:objectset-parity` filtro / skip

`--` extra fazia o Vitest ignorar o ficheiro. `skipIf(!db)` saía 0.

Correção: `object-set#test:parity` → `run-fail-closed-vitest.mjs tests/parity.integration.test.ts`. Exige `DATABASE_URL`, falha se skip / zero ficheiros / zero testes. Ficheiro colectado: `packages/object-set/tests/parity.integration.test.ts`.

### 1.4 PostgreSQL não fiável

Default implícito `:5432` batia noutro Postgres. `tryOpenIsolatedPg` engolia auth e devolvia `undefined` → `skipIf` → verde.

Correção: sem fallback `:5432`. `openIsolatedPg` (obrigatório) vs `tryOpenIsolatedPg` (opcional: só URL ausente ou `ECONNREFUSED`/ENOTFOUND). Auth/DB/role/migration **throw**. Compose: `${NEUMANN_POSTGRES_PORT:-55432}:5432`. `pnpm db:migrate` é o runner canónico.

### 1.5 Connectors `--passWithNoTests`

Vitest saía 0 sem ficheiros. Flag removida. Testes reais em csv/http/webhook.

### Extra: Turbo fail-fast

`pnpm test` agora usa `--continue`. `verify:unit` idem. 108/108 tasks na segunda execução (a primeira continuou após sandbox e revelou o `require(fs)` sob carga).

## 2. Ficheiros modificados (desta fase)

Não inclui o tsconfig protegido (já estava `M` antes; SHA inalterado).

- Runtime Node: `.nvmrc`, `.node-version`, `package.json` (root + `engines ^24.0.0` nos packages), `.github/workflows/ci.yml`
- Sandbox: `packages/execution-sandbox/src/core/worker-runner.ts`, `tests/worker-runner.test.ts`, `tests/gates.test.ts`
- PG: `packages/object-platform/src/core/pg-sql.ts`, `tests/pg-open.test.ts`, `tests/migrations.integration.test.ts`
- Gates: `packages/event-bus/src/cli.ts`, `src/cli-args.ts`, `tests/cli-args.test.ts`, `packages/object-set/package.json`
- Connectors: `packages/connector-{csv,http,webhook}/package.json` + `tests/*.test.ts`
- Compose / migrate / verify: `docker-compose.yml`, `scripts/{db-migrate.ts,pg-require.ts,dev-migrate-local.mjs,run-fail-closed-vitest.mjs,verify-*.mjs}`
- Docs: `docs/architecture/adr/0001-supported-node-runtime.md`, `docs/architecture/adr/README.md`, `docs/architecture/current-state.md`, este ficheiro

## 3. Unit vs integration

| Modo | Comando | Postgres | Skip |
|---|---|---|---|
| Unit | `pnpm verify:unit` | `DATABASE_URL` **unset** | `*.integration.test.ts` podem skipIf; **não** são apresentados como executados |
| Integration | `pnpm verify:integration` | `DATABASE_URL` obrigatório | **qualquer skip = exit ≠ 0** |

## 4–9. Evidência de execução

Ver secção 10 (comandos) e as tabelas abaixo.

### Migrations aplicadas (`pnpm db:migrate`)

`0001_outbox.sql` … `0014_er_gold_set.sql` (14 ficheiros). URL redacted: `postgres://neumann:***@127.0.0.1:55432/neumann`. Segunda execução no-op (checksums).

### Integration files (17, descoberta dinâmica)

| Ficheiro | Testes |
|---|---|
| `apps/erp-simulator/tests/closed-loop.integration.test.ts` | 1 |
| `packages/action-engine/tests/pg-durability.integration.test.ts` | 6 |
| `packages/entity-resolution/tests/pg-ledger.integration.test.ts` | 1 |
| `packages/event-bus/tests/outbox-reliability.integration.test.ts` | 2 |
| `packages/event-bus/tests/outbox-worker.integration.test.ts` | 1 |
| `packages/event-bus/tests/pg-outbox-canonical.integration.test.ts` | 2 |
| `packages/event-bus/tests/writeback-http.integration.test.ts` | 1 |
| `packages/object-platform/tests/migrations.integration.test.ts` | 6 |
| `packages/object-platform/tests/pg-concurrency.integration.test.ts` | 2 |
| `packages/object-platform/tests/pg-integrity.integration.test.ts` | 1 |
| `packages/object-set/tests/catalog.integration.test.ts` | 1 |
| `packages/object-set/tests/parity.integration.test.ts` | 2 |
| `packages/ontology-registry/tests/pg-registry.integration.test.ts` | 1 |
| `packages/platform-api/tests/end-to-end.integration.test.ts` | 1 |
| `packages/platform-api/tests/pg-platform-durability.integration.test.ts` | 3 |
| `packages/policy-engine/tests/pg-audit.integration.test.ts` | 3 |
| `packages/policy-engine/tests/pg-policy.integration.test.ts` | 4 |

**Total integração: 38 passed, 0 failed, 0 skipped.** (35 da baseline + 3 testes novos de migration/auth.)

### Unit (`verify:unit`, DATABASE_URL unset)

54 packages, turbo **108/108** successful na execução verde. **1252 passed, 0 failed, 38 skipped** (os 38 são `describe.skipIf(!db)` — esperados em modo unitário).

Connectors (também no unit):

| Package | Ficheiro | Testes |
|---|---|---|
| connector-csv | `tests/csv.test.ts` | 3 passed |
| connector-http | `tests/http.test.ts` | 4 passed |
| connector-webhook | `tests/webhook.test.ts` | 3 passed |

CAT em `packages/connector-acceptance-tests` mantido (4 testes). Sem dependência circular.

### Negativos PostgreSQL (`pnpm verify:pg-negative`)

| Caso | Exit | Mensagem (sem password) |
|---|---|---|
| `DATABASE_URL` ausente | 1 | `verify:integration requires DATABASE_URL (this is not a skip)` |
| Porta 1 | 1 | `PostgreSQL is not reachable … (ECONNREFUSED)` |
| Password inválida | 1 | `PostgreSQL authentication failed … (28P01)` |

Nenhum virou skip.

## 10. Comandos e exit codes (Node 24)

| Comando | Exit |
|---|---|
| `node --version` | 0 (v24.19.0) |
| `pnpm --version` | 0 (10.20.0) |
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm verify:typecheck` | 0 (74/74) |
| `pnpm verify:unit` | 0 (108/108; primeira tentativa 1 por `require(fs)` sob turbo, depois split do teste) |
| `pnpm db:migrate` | 0 |
| `pnpm verify:integration` | 0 (17 files, 38 tests, 0 skip) |
| `pnpm verify:build` | 0 (54/54) |
| `pnpm gate:bloco1` | 0 — observability `pass: true` (20/20) **e** `gate ok: committed event delivered exactly once after restart` |
| `pnpm gate:objectset-parity` | 0 — colectou **só** `tests/parity.integration.test.ts` (2 passed, 0 skip) |
| `pnpm gate:core` | 0 |
| `pnpm gate:platform` | **1** na 1ª (catalog search 105ms ≥ 100ms); **0** no retry |
| `pnpm gate:t1.3` | 0 (memória; 15000 unique / 0 dup) |
| `pnpm verify:all` | 0 |
| `pnpm verify:pg-negative` | 0 (os três casos internos saem ≠ 0) |

## 11. Falhas ainda abertas

- `object-set` catalog GIN `< 100ms` é sensível a carga (105ms vs 100ms). **Não** se alargou o assert. `gate:platform` não é estável à primeira.
- `gate:t1.3` e o `gate` do event-bus continuam a ser memória (já na baseline).
- `ctx.policy` (EPID) ≠ `ctx.authorizer` HTTP — fora de 01B.
- Volume compose antigo: initdb já não é a lista de migrations; upgrades = `db:migrate`.
- Node 26 local do host continua instalado via Homebrew; o runtime suportado é 24 (`.nvmrc`).

## 12. SHA do tsconfig protegido

Inicial (baseline + início 01B): `3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

Final: `3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

Conteúdo observado: `rootDir: src` (alteração pré-existente). Não editado, não restaurado, não staged por esta fase.

Sem `git commit` / `git push`.
