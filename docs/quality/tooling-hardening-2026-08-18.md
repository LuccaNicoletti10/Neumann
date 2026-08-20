# Tooling hardening — 2026-08-18 (Prompt 01C)

Evidência **depois** de centralizar TypeScript / Vitest / Fastify, tsconfigs, lint e coverage ratchet. Não substitui `docs/quality/baseline-2026-08-17.md`, `baseline-fixes-2026-08-17.md` nem `baseline-hardening-2026-08-17.md`.

Runtime: Node **v24.19.0**, pnpm 10.20.0, `DATABASE_URL=postgres://neumann:***@127.0.0.1:55432/neumann`. Sem retry, `|| true`, `continue-on-error` ou `passWithNoTests`.

SHA `packages/connector-webhook/tsconfig.json` (início = fim):

`3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

## 1. Inventário antes (medido, sem correção)

### 1.1 Versões resolvidas (`pnpm list -r --depth 0`)

| Pacote | Spec espalhada | Resolvido |
|---|---|---|
| TypeScript | `5.5.4` (maioria); `^5.4.0` / `^5.5.0` / `^5.6.2` | **5.5.4** vs **5.9.3** (auto-logging-config, dynamic-documentation, metrics-collection) |
| Vitest | `^2.1.9` (maioria); `^1.6.0`; `2.0.5`; `^2.0.0`; `^2.1.0`; `^2.1.1` | **2.1.9** vs **1.6.1** (auto-logging-config, ldpc-transceiver) vs **2.0.5** (common-build-system) |
| Fastify | `^4.28.0` / `^4.28.1` / `4.28.1` | **4.28.1** já unificado no lockfile |
| `@types/node` | `20.14.15` / `^20.0.0` / `^20.14.0` | **20.14.15** |

Lint: **ausente**. Zero `eslint.config.*` / `.eslintrc*`. Comentários `eslint-disable` órfãos em 5 ficheiros.

Coverage: **ausente**. Sem `@vitest/coverage-v8`, sem threshold, sem `verify:coverage`.

### 1.2 Tsconfigs

105 ficheiros `tsconfig*.json`. `tsconfig.base.json` existia; a maioria dos packages **não** o estendia — copiava `compilerOptions` (NodeNext, strict, verbatimModuleSyntax).

Ilhas:

- SHA-locked: `packages/connector-webhook/tsconfig.json` (sem `extends`).
- Já ligados à base: auto-logging-config, common-build-system, metrics-collection, dynamic-documentation (overrides redundantes `module`/`moduleResolution`).
- `exactOptionalPropertyTypes: true`: iam-auth-monitoring, periodic-search-manager, bounded-fair-scheduler, event-bus.
- Build = typecheck no mesmo ficheiro (`rootDir: src`): auto-logging-config, common-build-system, metrics-collection, dynamic-documentation, security-config-secrets.

### 1.3 Testes / coverage

Todos os 54 workspaces tinham ficheiros de teste (connectors CSV/HTTP/webhook já cobertos no 01B). Sem relatório de coverage. Packages sem testes: nenhum.

### 1.4 CI / scripts

Scripts canónicos incompletos: existiam `verify:typecheck|unit|integration|build|all`. Faltavam `verify:lint` e `verify:coverage`. Job `static` só typecheck; `unit` só unit; `postgres-integration` ainda chamava `gate:objectset-parity` à parte (já coberto por `*.integration.test.ts`).

## 2. Versões centralizadas (depois)

Fonte única: `pnpm-workspace.yaml` `catalog:` (mecanismo nativo pnpm).

| Nome | Catalog | Major preservada |
|---|---|---|
| `typescript` | `5.5.4` | 5 |
| `vitest` | `2.1.9` | 2 (exceções 1.x subiram após equivalência — §8) |
| `@vitest/coverage-v8` | `2.1.9` | plugin do Vitest 2 |
| `fastify` | `4.28.1` | 4 — continua **runtime** `dependencies` nos packages que o usam; não foi promovido a root `devDependency` |
| `@types/node` | `20.14.15` | types |

`pnpm list -r --depth 0` depois: TypeScript **5.5.4**, Vitest **2.1.9**, Fastify **4.28.1**, `@types/node` **20.14.15**, `@vitest/coverage-v8` **2.1.9** em todos os workspaces que os declaram. Zero deriva interna.

`pnpm install --frozen-lockfile` → exit 0 (lockfile regenerado uma vez de forma legítima).

Lint toolchain (só root, não catalog): ESLint 9.14.0, `typescript-eslint` 8.15.0, `@eslint/js` 9.14.0, `globals` 15.12.0.

## 3. Tsconfigs

Presets:

```
tsconfig.base.json     → strict / NodeNext / noUncheckedIndexedAccess / noFallthrough
tsconfig.node.json     → extends base; types:node; verbatimModuleSyntax; outDir dist
package tsconfig.json  → extends tsconfig.node.json + include + overrides locais
package tsconfig.build.json → extends ./tsconfig.json; rootDir src
```

Exceções locais (com `WHY:` no JSONC):

| Override | Motivo |
|---|---|
| `verbatimModuleSyntax: false` | package compilava sem verbatim; ligar seria type-fix, não preset |
| `exactOptionalPropertyTypes: true` | já estava; remover reduziria strictness |
| `noEmit: true` | typecheck-only; emit no `tsconfig.build.json` |
| `sourceMap` / `declarationMap: false` | emit já era assim; mudar output exige evidência de build |
| `rootDir: src` | build e typecheck partilham o ficheiro; testes fora do emit |

Ilha SHA (allowlist em `scripts/tooling/tsconfig-graph.mjs`):

- `packages/connector-webhook/tsconfig.json` — bytes intocados
- `packages/connector-webhook/tsconfig.build.json` — continua a estender o protegido

Gate: `verifyTsconfigGraph` — desconectado ou `compilerOptions` duplicados do pai → exit 1. Relatório desta sessão: `ok: true`, disconnected 0, duplicates 0.

Não se reduziu strictness. Module resolution e `outDir` do emit permaneceram NodeNext / `dist`.

## 4. Lint

`eslint.config.mjs` + `pnpm verify:lint`:

1. testes do tooling (`node --test`, 13/13);
2. protocolo `catalog:` + `@vitest/coverage-v8` em quem tem vitest;
3. `pnpm list -r --json` sem deriva;
4. grafo tsconfig;
5. ESLint `--max-warnings 0`.

Regras de defeito (type-aware):

- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/no-misused-promises` (`checksVoidReturn.properties: false` — Fastify `preHandler` async é API suportada)
- `@typescript-eslint/no-unused-vars` (`^_` permitido)
- `no-fallthrough`
- `@typescript-eslint/switch-exhaustiveness-check` com `considerDefaultExhaustiveForUnions: true` (o código já usa `default` para o resto da união)

### 4.1 Medição inicial (94 erros)

17 exhaustiveness (maioria `default` já cobria o resto; CLI `undefined`), 16 floating promises, 13 unused vars, 11 misused promises, 7 disable órfãos, ~20 parse errors fora de tsconfig, estilo residual.

### 4.2 Defeitos reais corrigidos (com teste quando o contrato muda)

| Achado | Correção |
|---|---|
| `SecretsManager.set` / `listKeys` async sem `await` no HTTP | Teste `secrets HTTP` **antes**; `await` no POST/GET. Sem await, GET serializava `Promise` como `{}` |
| CLI `runCommandLine().then(exitCode)` sem rejection handler | `.then(ok, err)` → `process.exitCode = 1` no throw |
| `node:http` `createServer(async …)` | listener devolve `void`; async interno (try/catch existente mantido) |
| unused vars / imports | prefixo `_` ou remoção; sem mudança de contrato |
| `eslint-disable` órfãos (`no-console`, `no-explicit-any`) | removidos |

Uma suppression justificada:

```
packages/execution-sandbox/tests/gates.test.ts
// WHY: the worker forbidden-API detector must see a real CJS require('fs').
```

Não é blanket. `reportUnusedDisableDirectives: error`.

Ignores com `WHY:`: `dist`, `coverage`, `node_modules`, `vitest.config.ts`, `examples/**`, `fixtures/**`, testes fora do emit tsconfig (alc/cbs/metrics/docs/webhook/secrets `test/`), `scripts/**/*.ts`. Produção `src/` continua lintada.

## 5. Coverage (dado → ratchet)

Primeira corrida `--measure`, **sem** threshold. `--coverage.all=true --coverage.include=src/**`. Quatro métricas.

Medido (unit partition, 199 ficheiros, `--coverage.all`). Os floats da primeira corrida foram escritos em `coverage/unit/measured.json` (gitignored). Os floors abaixo são a fonte versionada: cada valor é `Math.floor` da percentagem medida, nunca arredondado para cima.

Fonte: `docs/quality/coverage-thresholds.json`.

| Âmbito | statements | branches | functions | lines |
|---|---|---|---|---|
| **global** | 75 | 74 | 84 | 75 |
| action-engine | 74 | 65 | 87 | 74 |
| connector-sdk | 74 | 67 | 71 | 74 |
| contracts | 88 | 60 | 94 | 88 |
| event-bus | 33 | 70 | 75 | 33 |
| execution-sandbox | 71 | 69 | 88 | 71 |
| knowledge-graph | 68 | 68 | 86 | 68 |
| object-platform | 44 | 64 | 70 | 44 |
| object-set | 55 | 60 | 67 | 55 |
| ontology-registry | 58 | 61 | 84 | 58 |
| platform-api | 65 | 67 | 78 | 65 |
| policy-engine | 72 | 79 | 81 | 72 |

Thresholds = esses floors. Sem meta inventada (não 80%). Packages críticos (incluindo event-bus 33% e object-platform 44% em statements) têm piso próprio: o total global não os esconde.

Zero testes ou relatório ausente → exit 1. Packages críticos listados no JSON; falha se um deles sumir do relatório.

Exclusões (todas com `WHY:`):

- `**/dist/**` — emit gerado
- `**/node_modules/**` — vendor
- `**/*.d.ts` — declarations geradas
- `**/*.{test,spec}.*` — testes medem `src/`, não são a superfície de produção

Nenhuma exclusão de produção por cobertura baixa.

## 6. Scripts e CI

Canónicos:

```
verify:lint
verify:typecheck
verify:unit
verify:coverage
verify:integration
verify:build
verify:all
```

`verify:all` executa os sete em ordem e para no primeiro não-zero.

CI Node 24:

| Job | Comandos |
|---|---|
| `static` | `verify:lint` + `verify:typecheck` |
| `unit` | `verify:unit` + `verify:coverage` |
| `postgres-integration` | build `object-platform` + `db:migrate` + `verify:integration` (inclui parity) |
| `build` | `verify:build` |

Sem `continue-on-error`, `|| true`, retry, skip, `passWithNoTests`.

## 7. Comandos, exit codes, contagens

Ambiente: Node v24.19.0, pnpm 10.20.0, Postgres 16 em `:55432`.

| Comando | Exit | Duração | Notas |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 1s | lockfile up to date |
| `pnpm verify:lint` | 0 | 17s | tooling 13/13; ESLint 0 errors / 0 warnings |
| `pnpm verify:typecheck` | 0 | 40s | 74/74 turbo |
| `pnpm verify:unit` | 0 | 43s | 199 files, **1272** passed, **0** skipped |
| `pnpm verify:coverage` | 0 | 44s | ratchet vs floors medidos |
| `pnpm db:migrate` | 0 | <1s | `applyPlatformMigrations` |
| `pnpm verify:integration` | 0 | 29s | 17 files, **38** passed, **0** skipped |
| `pnpm verify:build` | 0 | 2s | 54/54 |
| `pnpm verify:all` #1 | 0 | 102s | primeira tentativa |
| `pnpm verify:all` #2 | 0 | 107s | primeira tentativa |

Skips nos canónicos: **zero**. `UNIT ∩ INTEGRATION = ∅`. 216 = 199 ∪ 17.

## 8. Equivalência de major (Vitest 1 → 2, TS 5.9 → 5.5)

Não se forçou runtime como devDependency. Remoção de ilhas só depois de:

- auto-logging-config + ldpc-transceiver: Vitest 1.6.1 → 2.1.9; suíte unitária verde.
- auto-logging-config, dynamic-documentation, metrics-collection: TypeScript 5.9.3 → 5.5.4 (major 5); `verify:typecheck` verde.

Fastify já era 4.28.1 resolvido; o catalog só congela o spec.

## 9. SHA protegido

Inicial: `3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

Final: `3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

O ficheiro continua `M` no worktree (alteração pré-01C). 01C não o editou.

## 10. Ficheiros desta fase (01C)

Não inclui o tsconfig protegido. Preserva o resto do worktree 01A/01B.

- Catalog: `pnpm-workspace.yaml`, `package.json` (root + packages + erp-simulator), `pnpm-lock.yaml`
- Presets: `tsconfig.node.json`; tsconfigs de package/app (extends + overrides); `tsconfig.test.json` em alc/cbs/metrics/docs/webhook
- Lint: `eslint.config.mjs`, `scripts/verify-lint.mjs`, `scripts/tooling/{jsonc,tsconfig-graph,workspace-versions,coverage-ratchet}*.mjs`
- Coverage: `scripts/verify-coverage.mjs`, `docs/quality/coverage-thresholds.json`, `run-vitest-files.mjs` (`coverageDir`)
- CI: `.github/workflows/ci.yml`; `scripts/verify-all.mjs`
- Defeitos lint: CLIs (rejection handler), secrets HTTP + testes, `createServer` async, unused, disables órfãos
- Mapa: `docs/architecture/current-state.md` §1
- Este relatório

## 11. Débitos restantes

- Coverage de `event-bus` (33% statements) e `object-platform` (44%) está **visível** no ratchet; não foi maquilhada. Subir exige testes, não exclusão de `src/`.
- Testes fora do emit tsconfig (alc/cbs/metrics/docs/webhook/secrets `test/`, `scripts/*.ts`) não passam no project service do ESLint; `src/` de produção sim.
- `@typescript-eslint/no-explicit-any` desligado — constituição já proíbe `any`; limpeza é débito separado.
- `tsx` continua com specs `^4.16.0` / `^4.19.0` (fora do conjunto obrigatório TypeScript/Vitest/Fastify).
- `platform_objects_pk_trgm` em schema isolado, EPID ≠ authorizer HTTP — débitos 01B.1, fora de 01C.

Sem `git commit` / `git push`.

## 12. Veredito

**VERDE**

- Sem drift injustificado de TypeScript / Vitest / Fastify.
- Lint e coverage fail-closed.
- Thresholds = floor da medição, quatro métricas, packages críticos não escondidos.
- Tsconfigs com fonte comum + allowlist SHA.
- Duas execuções de `verify:all` verdes na primeira tentativa, zero skips.
- Uma suppression justificada; exclusões só generated/vendor/test surface.
- SHA protegido inalterado.
