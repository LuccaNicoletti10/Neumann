# Mutation boundaries — 2026-08-18

## Veredito

**VERDE** — `verify:all` ×2 exit 0, skips 0. Nenhuma API pública ou UI/LLM escreve objects/links fora de Actions. Projeção não deixa estado parcial (PG rollback; memory abandon+compensating delete).

## Call graph

### Antes

```
HTTP POST/PUT/DELETE /api/v2/.../objects
HTTP POST /api/v2/.../links
  → write-guard (svc-projector | svc-migration)
  → ctx.objects.create/update/delete | ctx.links.create
  → events.append (ad hoc no handler)

UI/LLM/humano
  → POST .../actions/{action}/apply
  → ActionExecutor

ERP simulator / testes
  → ctx.objects.create  (mesmo repository)
```

### Depois

```
UI/LLM/humano
  → POST .../actions/{action}/apply
  → ActionExecutor
       authorize → validate → UoW (rules + history + event + audit + outbox)

ERP / connector / projector (mesmo processo)
  → ctx.projections (ProjectionWriter)
       authorize admin:projection
       → validate ontology
       → claim (source, ontologyId, sourceEventId)
       → UoW (object/link + history + event + outbox + ledger)

HTTP POST/PUT/DELETE objects, POST links
  → declarePolicy (ainda)
  → 405 ACTION_REQUIRED
  → não chama repository
```

Não há `/internal/v1/projections`: nenhum caller cross-process.

## Actions versus ProjectionWriter

| | ActionExecutor | ProjectionWriter |
|---|---|---|
| Quem | UI, LLM, humano | ERP, connector, projector |
| Identidade | `idempotencyKey` | `sourceEventId` por `source`+ontology |
| CAS | `expectedObjectVersions` | `expectedVersion` |
| Ledger | `ActionExecution` | `projection_ledger` (não é ActionExecution) |
| Policy | `ResourceIds.action` | `ResourceIds.admin('projection')` |
| HTTP | `POST .../actions/{action}/apply` | nenhuma rota pública |
| Outbox | existente | o mesmo `OutboxRepository` |

Mutating Action sem `idempotencyKey` falha antes do claim (zero writes). Modify/delete/generate_document sem `expectedObjectVersions` idem.

## Rotas

| Rota | Antes | Depois |
|---|---|---|
| POST `/api/v2/ontologies/:o/objects/:type` | escrevia | 405 `ACTION_REQUIRED` |
| PUT `/api/v2/ontologies/:o/objects/:type/:pk` | escrevia | 405 |
| DELETE `/api/v2/ontologies/:o/objects/:type/:pk` | escrevia | 405 |
| POST `.../objects/:type/:pk/links/:linkType` | escrevia | 405 |
| POST `.../actions/:action/apply` | Action | Action (inalterado) |
| `/internal/v1/projections` | n/a | **não criado** |

`registerWriteGuard` removido. `PublicPlatformContext` expõe só leitores + Actions.

## Transação / idempotência

**Action (PG):** `ActionUnitOfWork` = uma transação SQL. Claim de `idempotencyKey` no execution store. Replay devolve a execução original. Stale CAS e deny não deixam objeto/event/outbox extras.

**Projection (PG):** `ProjectionUnitOfWork` usa o mesmo `TransactionManager`. `INSERT ... ON CONFLICT DO NOTHING` no ledger; o segundo caller espera o commit do primeiro e lê o resultado completo.

**Projection (memory):** claim não publica o resultado até `complete`. Waiters aguardam o in-flight. Falha: `abandon` + delete compensatório do objeto criado. Event/outbox só após writes bem-sucedidos no caminho feliz; falha injectada no `create` prova rollback observável. Atomicidade de produção é o PG.

Replay: mesmo hash → `status: 'replayed'`, sem segundo event/outbox. Hash diferente → `ProjectionConflictError`, sem writes extras.

## Testes

| # | Prova | Onde |
|---|---|---|
| 1 | rotas públicas não escrevem | `platform-api/tests/mutation-boundaries.test.ts` |
| 2–5 | Action uma vez / dup / stale / deny | mutation-boundaries + `action-engine/tests/executor.test.ts` + passo24 |
| 6–8 | projection write / replay / payload conflict | `object-platform/tests/projection-writer.test.ts` |
| 9–10 | rollback após write; history/event/outbox/ledger | memory compensating + PG `projection.integration.test.ts` |
| 11 | deny não revela/escreve | projection-writer + mutation-boundaries |
| 12 | concorrência = um commit | memory + PG |
| 13 | restart PG preserva idempotência | projection.integration + action-engine pg-durability |
| 14 | memory/PG mesmo contrato observável | replay/conflict/deny/CAS |

Failure injection: throw real após `objects.create`, não mock que sempre passa.

## Coverage

Ratchets elevados, nunca reduzidos.

| | statements | branches | functions | lines |
|---|---|---|---|---|
| global (floor) | 76 | 75 | 85 | 76 |
| action-engine | 76 (era 75) | 67 (66) | 88 (87) | 76 (75) |
| contracts | 88 | 61 (60) | 95 (94) | 88 |
| object-platform | 53 (44) | 70 (64) | 70 | 53 (44) |
| platform-api | 71 (70) | 71 | 87 | 71 (70) |
| policy-engine | 86 | 84 | 92 | 86 |

Medido: global 76.55 / 75.34 / 85.19 / 76.55.

## Migration

`infra/sql/0017_projection_ledger.sql`

```
PRIMARY KEY (source, ontology_id, source_event_id)
```

Append-only. `applyPlatformMigrations` aplica por checksum.

## SHA protegido

`packages/connector-webhook/tsconfig.json` não alterado. Esperado:

```
3daa3880dae2abed6be7e5609c93d7807afceed9128ecc147a909569e57b6437
```

## Débitos restantes

- Tombstones 405 até os clientes pararem de chamar as rotas.
- `createObjectPlatform` Maps continua projector legado (decisão 2).
- Memory Action UoW ainda não é clone/commit (target-state §5).
- `registerActionType` cache paralelo à ontology (decisão 6).
- POST `/actionTypes` e POST `/ontologies` ainda escrevem ontology (fora deste prompt).
- EPID `createResource` não é API HTTP admin.
- Approval resume (`approve`) não re-aplica `expectedObjectVersions` (não persistidos na row de execução).
- Outbox `projection.applied` sem handler dedicado (UNHANDLED no drain de writeback de Action).

## Gates

| Comando | Exit |
|---|---|
| `pnpm verify:lint` | 0 |
| `pnpm verify:typecheck` | 0 |
| `pnpm verify:unit` | 0 |
| `pnpm verify:coverage` | 0 |
| `pnpm db:migrate` | 0 |
| `pnpm verify:integration` | 0 |
| `pnpm verify:build` | 0 |
| `pnpm gate:core` | 0 |
| `pnpm gate:platform` | 0 |
| `pnpm gate:t1.3` | 0 |
| `pnpm verify:all` #1 | 0 |
| `pnpm verify:all` #2 | 0 |

Skips: 0 nas partições unit/integration. `packages/connector-webhook/tsconfig.json` SHA inalterado.
