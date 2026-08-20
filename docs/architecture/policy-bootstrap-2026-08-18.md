# Policy única + bootstrap assíncrono — 2026-08-18

## Veredito

**VERDE**

Uma `PolicyRuntime` governa HTTP reads, redaction, aggregates, Actions e mutations. Overlay RBAC e grafo EPID compartilham a mesma geração. `OntologyAuthorizer` é compilador de fixture (`createPolicyRuntimeFromOverlay`), não autoridade paralela. Persistência falha visível. `listen` só após policy (+ seed). Sem `policyReady` não awaited, sem `console.error` no persist do engine/audit sink, sem allow-all implícito no `PlatformContext`.

## Autoridade

| | Antes | Depois |
|---|---|---|
| HTTP Actions+Reads | `OntologyAuthorizer` | `ctx.policy` (`PolicyRuntime`) |
| EPID | `PolicyEngine` hidratado, ignorado no HTTP | mesmo snapshot; nós nativos via `engine.authorize` |
| Default memória | `allowAll` implícito | fixture explícita `allow-all` / overlay / `policy` |
| Persist | `enqueue` + `console.error` | `flush()` / `drain()` relançam; `replaceSnapshot` transacional |
| Bootstrap | `policyReady = hydrate()` sem await | `createPolicyRuntime` + `createPlatformRuntime` awaited |

`authorizeFn` no `ActionExecutor` **é** `policy.authorize` (mesmo objeto função).

## Lifecycle

```
validate config
→ open dependencies
→ validate schema (0010 + 0015)
→ await createPolicyRuntime (snapshot ready)
→ await seed (se houver; memória recusa seed síncrono)
→ ctx.ready = true
→ listen
```

Falha fecha recursos abertos pela factory, não abre porta, CLI `process.exit(1)`.

- `/health` = processo vivo (200).
- `/ready` = 200 somente `ctx.ready`; 503 durante bootstrap/shutdown.

Update administrativo:

```
validate overlay → persist transactionally (replaceSnapshot) → load snapshot → atomic publish → audit
```

Persist throw: geração inalterada. Leitores veem geração N ou N+1, nunca híbrida.

## Matriz rota → resource → operation

| Rota | Resource | Operation | Hidden-miss |
|---|---|---|---|
| GET objects / get / history / links | `ResourceIds.objectType` | `read` (`list`/`count` → read) | lista vazia / GET 404 |
| POST objectSets/loadObjects | `object:` tipos do set | `read` | `{ data: [] }` |
| POST objectSets/aggregate | `object:` | `read`; redact **antes** de aggregate | count 0 / sum null |
| POST graphPatterns/execute | `ctx.policy` no explorer | `read` | nós omitidos |
| GET catalog/search | `object:` por hit | `read` | hit omitido |
| POST/PUT/DELETE objects, POST links | `object:` | `create`/`modify`/`delete` | erro (write-guard + policy) |
| POST actions/{action}/validate\|apply | `ResourceIds.action` | `modify` | deny no executor |
| POST executions/:id/approve\|reject | `ResourceIds.actionExecution` | `modify` | deny |
| GET/POST ontologies, actionTypes, render | — | ainda sem overlay admin | débito |

IDs só via `ResourceIds` nas rotas de negócio e no executor. Prefixos: `object:`, `action:`, `action-execution:`, `link:`, `admin:` (longest-match).

## Testes / coverage

Provas 1–11: `policy-bootstrap.test.ts`, `policy-runtime.test.ts`, `policy-overlay.test.ts`, `policy-store.test.ts`, `policy-runtime.integration.test.ts`.

Ratchet elevado (medição subiu; nunca reduziu):

| Pacote | Antes | Depois (floor) | Medido |
|---|---|---|---|
| global | 75/74/84/75 | 76/75/85/76 | 76.17 / 75.x / 85.x / 76.17 |
| platform-api | 65/67/78/65 | 67/69/82/67 | 67.34 / 69.12 / 82.08 / 67.34 |
| policy-engine | 72/79/81/72 | 85/84/91/85 | 85.99 / 84.73 / 91.61 / 85.99 |

## Comandos e exits

| Comando | Exit |
|---|---|
| `pnpm verify:lint` | 0 |
| `pnpm verify:typecheck` | 0 |
| `pnpm verify:unit` | 0 |
| `pnpm verify:coverage` | 0 |
| `pnpm db:migrate` | 0 (`0015_policy_overlay.sql` aplicada) |
| `pnpm verify:integration` | 0 (skipped 0) |
| `pnpm verify:build` | 0 |
| `pnpm gate:core` | 0 |
| `pnpm gate:platform` | 0 |
| `pnpm verify:all` ×2 | 0, 0 (primeira tentativa desta série após limpeza de emit; skipped 0) |

## Arquivos (policy / bootstrap)

Novos: ADR-0003, `0015_policy_overlay.sql`, `policy-overlay.ts`, `policy-runtime.ts`, `resource-ids.ts`, `bootstrap.ts`, testes listados acima.

Tocados: `engine.ts`, `audit.ts`, `ontology-authorizer.ts`, `policy-store.ts`, `pg-policy-store.ts`, `context.ts`, `cli.ts`, `server.ts`, `secured-reads.ts`, `routes/v2.ts`, `action-engine/executor.ts`, `current-state.md`, `coverage-thresholds.json`.

`outDir: dist` em tsconfigs que compilam via `tsconfig.json` (evita emit em `src/` que quebra eslint). Não alterar `packages/connector-webhook/tsconfig.json`.

## Débitos

- HTTP POST/PUT/DELETE `/objects` ainda existe (write-guard de serviço); não é segunda policy.
- Overlay `*` não expande para nós EPID (ADR-0003 Alt B rejeitada).
- `createActionExecutor` / `createObjectPlatform` ainda defaultam `allowAll` fora de `PlatformContext`.
- Rotas ontology/actionTypes/render sem `ResourceIds.admin`.
- Cliente SQL injetado não é fechado na falha de hydrate (só o aberto pela factory).
- Audit de `publishOverlay` é após persist; falha de audit não reverte geração durável.
- Alias deprecado `opts.authorizer` ainda aceito como input do compilador.

## SHA protegido

`packages/connector-webhook/tsconfig.json`

```
3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437
```
