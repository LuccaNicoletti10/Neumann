# ADR-0009: Uma autoridade de policy, bootstrap awaited, réplicas via LISTEN

- Status: accepted
- Date: 2026-08-18
- Deciders: Neumann kernel maintainers
- Contracts touched: none (`AuthorizeRequest` / `PolicyEngine` stay v1)
- Packages touched: `policy-engine`, `platform-api`, `object-platform`
- Supersedes: ADR-0003 gap `ctx.policy` ≠ `ctx.authorizer`; current-state item 16 (migrations no startup)

## Context

Prompt 07 fechou `partial`, overlay escopado e CAS. Três P0 restavam:

1. `opts.authorizer` ainda podia injectar um `PolicyRuntime` distinto de `ctx.policy`.
2. `createPostgresPlatformContext` validava o schema mas não aplicava migrations; `policy.hydrate()` no engine EPID nativo não é o bootstrap HTTP.
3. Réplicas observavam generation por poll in-process; a prova não usava duas conexões PG reais nem LISTEN.

## Decision

### 1. Uma autoridade

`PlatformContext.policy` é o único evaluator HTTP/Actions/Reads.

`ctx.authorizer` é o **mesmo objecto** que `ctx.policy` (alias sem estado). `ctx.authorizer.authorize === ctx.policy.authorize`.

Passar `opts.policy` e `opts.authorizer` diferentes é erro (segundo evaluator). `createPolicyEngine` / `hydrate()` não entram em `platform-api` src. Gate estático recusa esses imports.

`createOntologyAuthorizer` continua fixture compiler. O resultado, se usado no HTTP, **é** `ctx.policy`.

### 2. Bootstrap

`createPostgresPlatformContext` / `createPlatformRuntime` só devolvem `ready=true` depois de:

```
open sql → applyPlatformMigrations → validate policy schema
  → await createPolicyRuntime (snapshot)
  → await startNotifications (LISTEN)
  → await catalog sync (idêntico não bumpa generation)
  → await seed
  → ready=true
```

Falha em qualquer passo fecha recursos e não devolve context ready. `createPlatformServer` e `listen()` recusam `!ctx.ready`. `/health` é liveness; `/ready` é 200 só com `ready && !degraded()`.

### 3. Réplicas PostgreSQL

`createPgSqlClient.listen(channel, onNotify)` segura uma conexão dedicada (`LISTEN`). `createPgPolicyStore.startNotifications()` liga `neumann_policy_generation`.

Dois `PolicyRuntime` com pools independentes no mesmo schema: publish/revoke em A notifica B; B faz `refresh()` e passa a negar sem restart. Encerrar B e reabrir carrega a generation corrente.

SqlClient de teste sem `listen` usa poll de 100 ms no store (documentado; não é o caminho de produção).

Publishers concorrentes: CAS na generation; um commit e um `PolicyGenerationConflict`; o overlay vencedor permanece.

## Consequences

### Positivas

- Impossível servir negócio com evaluator paralelo ou sem snapshot.
- Réplica B observa revoke sem restart em PostgreSQL real.

### Negativas / custo

- `LISTEN` é por database, não por schema isolado de teste: payload dispara refresh; o snapshot lido é o do `search_path` da réplica (notify cruzado é no-op se a generation local não mudou).
- `createPolicyEngine.hydrate()` permanece para o grafo EPID nativo (testes de store). Não é autoridade HTTP.

### Invariantes que os testes devem provar

- `ctx.authorizer === ctx.policy` e `authorize` é a mesma função.
- `opts.policy !== opts.authorizer` lança; zero listen.
- Migrate/schema/snapshot/catalog throw → resources closed, `ready` nunca true.
- Duas conexões PG: revoke em A → B nega; kill/reopen B recupera; refresh fail → `/ready` 503.
- Dois publishers: um fulfilled, um `PolicyGenerationConflict`.
- Catálogo idêntico no segundo bootstrap não altera generation.

## Alternatives considered

### Alt A — Manter `authorizer` como segundo PolicyRuntime

Rejected. Duas autoridades.

### Alt B — Só poll, sem LISTEN

Rejected para produção. Poll fica só para fakes sem sessão.

### Alt C — Hydrate do `PolicyEngine` como bootstrap HTTP

Rejected. HTTP observa `PolicyRuntime` snapshot; `hydrate()` é o store EPID nativo.
