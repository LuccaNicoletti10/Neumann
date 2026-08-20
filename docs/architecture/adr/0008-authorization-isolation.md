# ADR-0008: Interpretação canónica de AuthorizeResult, overlay escopado e publish CAS

- Status: accepted
- Date: 2026-08-18
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/policy.ts` (`allowsMutation`, `allowsRead`, `isReadOperation`, `authorizeProceeds` — additive)
- Packages touched: `policy-engine`, `platform-api`, `action-engine`, `object-platform`, `explore-api`
- Supersedes: ADR-0004 overlay grant shape (actions `*` implying admin/functions/links); ADR-0004 public HEAD bypass

## Context

Auditoria P0: `decision !== 'deny'` autorizava mutações com `partial`; overlay `actions: ['*']` compilava Functions, admin, ontology modify e LinkTypes; `approverPolicy` era string comparada por nome; render/catalog/Functions liam propriedades cruas; HEAD saltava o `preHandler`; `replaceSnapshot` era last-write-wins sem CAS nem refresh de réplica.

## Decision

### 1. AuthorizeResult

Uma função em `contracts`: `authorizeProceeds(operation, result)`.

- Mutação (`create`/`modify`/`delete`) e admin: somente `decision === 'allow'`.
- Leitura (`read`/`list`/`count`): `allow` ou `partial`.
- `partial` nunca autoriza escrita. Não é promovido a `allow`.
- `partial` em leitura: o principal vê o recurso (existência não é hidden-miss); field masks do overlay ainda aplicam. Motivo EPID: herança dá read, write exige policy explícita no nó.

Call sites de escrita usam `allowsMutation`. Proibido `decision !== 'deny'` em caminhos de mutação.

### 2. Overlay escopado

`OntologyGrant` selectors independentes:

```
ontologyIds, objectTypes, linkTypes, actions, functions,
adminResources, approverPolicies, operations, hiddenProperties
```

`actions: ['*']` expande só Actions no catálogo, filtradas por `ontologyIds`. Não concede Functions, admin, projection, ingest, approvals nem ontology modify.

ObjectTypes não selecionam LinkTypes. O mesmo `id` em duas ontologies não partilha permissão: compile casa `(ontologyId, localId)`.

Wildcard `*` expande só dentro das ontologies selecionadas. Overlay antigo sem os novos campos: selectors omissos = vazio (fail-closed, sem ganho de privilégio). `ontologyIds` omisso = só `KERNEL_ONTOLOGY`.

Redaction recebe `ontologyId + objectTypeId`.

### 3. approverPolicy

É uma **policy** (não resource solto nem role HTTP). Recurso canónico:

```
ResourceIds.approver(ontologyId, policyName) → approver:{ontology}/{policyName}
```

`approve`/`reject` exigem `allowsMutation` nesse resource. Self-approval continua bloqueado. ActionType sem `approverPolicy` com `approvals.required` → deny, zero writes. Revalidação do ActionType pinado, policy e versões permanece na transação/CAS.

### 4. Publish CAS + réplicas

`replaceSnapshot(next, expectedGeneration)` faz compare-and-swap da generation. Conflito → `PolicyGenerationConflict` visível; nenhuma actualização desaparece.

Réplicas observam via `subscribeGeneration` (memory) / `pg_notify` + `refresh()` (PG). Falha de refresh: última geração válida permanece; `policy.degraded() === true`; `/ready` 503.

`publishCatalog` com catálogo canonicamente idêntico não incrementa generation.

### 5. Rotas públicas e HEAD

Públicos: `GET|HEAD /health`, `GET|HEAD /ready`, `OPTIONS`. HEAD herda auth, policy e hidden-miss do GET. `declarePublicRoute` só é válido nesses casos. A lista de rotas vive na instância Fastify, não num array global.

## Consequences

### Positivas

- Uma interpretação de `AuthorizeResult`. Overlay não cruza kinds nem ontologies.
- Approvals endereçam um ResourceId. Réplicas negam após revoke sem restart.

### Negativas / custo

- Overlays persistidos só com `actions: ['*']` perdem admin/functions/links até republicar selectors explícitos (fail-closed intencional).
- Catálogo passa a listar `approverPolicies` extraídos dos ActionTypes.

### Invariantes que os testes devem provar

- Matriz deny/partial/allow em HTTP mutation, Action apply/resume/approve, ProjectionWriter, Functions.
- `partial` → zero writes.
- Duas ontologies, mesmo type id, permissões/redactions distintas.
- `actions:['*']` não concede admin/Function/projection.
- Manager aprova; comum nega; requester não autoaprova; CAS um vencedor.
- Render/catalog/Functions não devolvem hidden properties; catalog count omite tipos negados.
- HEAD protegido indistinguível do GET.
- Réplica B observa revoke de A; dois publishers → um conflito; catálogo idêntico não muda generation.

## Alternatives considered

### Alt A — Tratar `partial` como allow em escrita para “não quebrar herança EPID”

Rejected. Fail-open. Write exige policy explícita no nó (já era a semântica EPID de `partial`).

### Alt B — Manter `actions: ['*']` como super-grant e filtrar no HTTP

Rejected. Segundo evaluator. Compile-time é a única expansão.

### Alt C — Last-write-wins no overlay com polling lento

Rejected. Perde updates. CAS + notify/refresh.
