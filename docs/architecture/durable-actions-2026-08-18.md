# Durable Actions — 2026-08-18

Prompt 05. ADR-0006 (accepted). Migration `0018_action_execution_envelope.sql`.

**VERDE** — restart, concorrência e falha injetada não duplicam execução nem aplicam ActionType obsoleta.

## ActionType

**Antes:** `ActionExecutor.registerActionType` / `getActionType` (Map no executor). HTTP `ensureActionType` copiava latest a cada validate/apply. Resume após pause/restart resolvia latest de novo.

**Depois:** `ActionDefinitionResolver.resolve(ontologyId, ontologyVersionId, actionTypeId)` sobre `OntologyRegistry` somente. Definição congelada + `hashCanonical`. Primeiro apply pinna latest uma vez. Resume nunca chama latest. Hash divergente ou versão ausente → `FAILED` fechado, zero writes.

## State machine

Tabela única em `action-lifecycle.ts`. Terminais não saem.

```
PENDING → AUTHORIZED | DENIED | FAILED
AUTHORIZED → VALIDATED | DENIED | FAILED
VALIDATED → RUNNING | AWAITING_APPROVAL | FAILED
AWAITING_APPROVAL → RUNNING | REJECTED | DENIED | FAILED
RUNNING → SUCCEEDED | FAILED
SUCCEEDED | FAILED | DENIED | REJECTED → ∅
```

Write-back de aprovação: CAS `AWAITING_APPROVAL → RUNNING` (não `PENDING → RUNNING`). Perdedor não corre rules; devolve o resultado persistido.

## Envelope / CAS

Persistido em `ActionExecution` + colunas `0018` (nullable, backward-safe):

`ontologyId`, `ontologyVersionId`, `actionTypeId`, `actionTypeHash`, `parameters`, `principal`, `idempotencyKey`, `expectedObjectVersions`, `policyGeneration`.

Resume sem pins falha fechado. Objeto mutado na espera → conflict, zero writes, auditado. Duplicate idempotency → mesma linha. Policy revogada na espera → `DENIED`. Dois approvers → uma execução.

## UoW memory / PG

| | Memory | PostgreSQL |
|---|---|---|
| Transação | `createSnapshotUnitOfWork` (capture/restore) | `txManager.transaction` + `bind(tx)` |
| Stores | objects, links, history, events, outbox, executions, ledger | mesmos contratos via SQL |
| Falha visível | `createFailureSurvivingExecutor` no root store | o mesmo |
| ProjectionWriter | UoW; sem `abandon` / compensating delete | UoW SQL |

Registro FAILED/DENIED que precisa sobreviver é gravado **fora** da transação (wrapper), nos dois adapters.

## Migration

`infra/sql/0018_action_execution_envelope.sql` — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (append-only). Aplicada: `pnpm db:migrate` lista `0018_action_execution_envelope.sql`.

Linhas pré-0018 não podem ser aprovadas (fail closed).

## Testes

`packages/action-engine/tests/durable-actions.test.ts` (memória 1–3, 5–11, 13 + resolver + failure-surviving).
`packages/action-engine/tests/pg-durability.integration.test.ts` (4, 12, 14 — restart, concorrência, envelope).
`packages/platform-api/tests/mutation-boundaries.test.ts` (HTTP actionTypes só ontology; projection delete).
`packages/contracts/tests/action-runtime.test.ts` (sem `registerActionType` no contrato).

Concorrência real (`Promise.all` approvers + idempotency). Failure injection real (throw após `objects.create`). Zero skips.

## Coverage (ratchet, floors; nunca reduzidos)

| | statements | branches | functions | lines |
|---|---|---|---|---|
| global | 76 | 75 | 85 | 76 |
| action-engine | 79 (era 76) | 72 (era 67) | 92 (era 88) | 79 (era 76) |
| object-platform | 54 (era 53) | 72 (era 70) | 72 (era 70) | 54 (era 53) |
| platform-api | 72 (era 71) | 72 (era 71) | 87 | 72 (era 71) |

Medido action-engine functions 92.15%; platform-api functions 87.73%.

## Comandos / exits

| comando | exit | skips |
|---|---|---|
| `pnpm verify:lint` | 0 | 0 |
| `pnpm verify:typecheck` | 0 | — |
| `pnpm verify:unit` | 0 | 0 (1359 passed, 210 files) |
| `pnpm verify:coverage` | 0 | 0 |
| `pnpm db:migrate` | 0 | 0018 aplicada |
| `pnpm verify:integration` | 0 | 0 (42 passed, 19 files) |
| `pnpm verify:build` | 0 | — |
| `pnpm gate:core` | 0 | 0 |
| `pnpm gate:platform` | 0 | 0 |
| `pnpm gate:t1.3` | 0 | 0 |
| `pnpm verify:all` ×1 | 0 | 0 |
| `pnpm verify:all` ×2 | 0 | 0 |

## Arquivos

- `packages/contracts/src/v1/action-runtime.ts`, `packages/contracts/src/v1/index.ts`
- `packages/action-engine/src/core/{executor,action-lifecycle,action-definition-resolver,failure-surviving-executor,pg-execution-store,execution-store}.ts`
- `packages/object-platform/src/core/{memory-checkpoint,projection-writer,*repository,*ledger,*history*}.ts`
- `packages/platform-api/src/core/context.ts`, `packages/platform-api/src/routes/v2.ts`
- `infra/sql/0018_action_execution_envelope.sql`
- `docs/architecture/adr/0006-durable-action-execution.md`
- `docs/architecture/current-state.md`
- `docs/quality/coverage-thresholds.json`

`packages/connector-webhook/tsconfig.json` SHA inalterado:
`3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437`

## Débitos

- Linhas de execução pré-0018 não são aprováveis (fail closed até novo apply).
- Ontology drafts PG continuam session-local (decisão 17).
- HTTP 405 tombstones, ontology admin HTTP, handler de `projection.applied`: fora de escopo (UNHANDLED no outbox permanece).
- `createObjectPlatform` Maps projector inalterado (decisão 2).
- Memory ainda sem `createGovernedObjectRepository` (decisão 7).
- `console.error` no `createFailureSurvivingExecutor` se o save do registro de falha falhar (não mascara o resultado).
