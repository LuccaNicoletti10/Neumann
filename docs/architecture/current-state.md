# Estado atual do kernel Neumann

Inventário factual após leitura de README, workspace, tsconfig, CI, `packages/contracts` e entrypoints dos pacotes core. Não declara gaps como resolvidos.

Snapshot anterior (mais curto, ainda válido como overview): [`docs/architecture.md`](../architecture.md). Auditoria de consolidação: [`docs/platform-consolidation-audit.md`](../platform-consolidation-audit.md).

## 1. Monorepo e ferramenta

| Item | Onde |
|---|---|
| Workspace | `pnpm-workspace.yaml` — `packages/*` + `apps/erp-simulator`; catalog: TypeScript 5.5.4, Vitest 2.1.9, Fastify 4.28.1 |
| Root | `package.json` `neumann@0.1.0`, `packageManager: pnpm@10.20.0`, `engines.node ^24.0.0` (ADR-0001) |
| TS | `tsconfig.base.json` + `tsconfig.node.json`; packages extend the node preset. Exception: SHA-locked `packages/connector-webhook/tsconfig.json` |
| Lint | `eslint.config.mjs` + `pnpm verify:lint` (catalog protocol, tsconfig graph, storage kernel, ESLint) |
| Coverage | `docs/quality/coverage-thresholds.json` + `pnpm verify:coverage` (four-metric ratchet from 2026-08-18 measurement) |
| Tasks | `turbo.json` — `build` / `test` / `typecheck`; `globalEnv`: `DATABASE_URL`, `CONNECTOR_PROTOCOL`, `AGE_BIN` |
| CI | `.github/workflows/ci.yml` — Node 24; `static` (lint+typecheck), `unit` (unit+coverage), `postgres-integration` (migrate+integration), `build` |
| Compose | `docker-compose.yml` — Postgres host `${NEUMANN_POSTGRES_PORT:-55432}:5432`; migrations via `pnpm db:migrate`, not initdb |
| SQL | `infra/sql/0001_outbox.sql` … `0026_history_seq_function_read_seq.sql` |
| Runner | `applyPlatformMigrations` em `packages/object-platform/src/core/pg-sql.ts` (`pnpm db:migrate`) |

`apps/console` existe (`apps/console/index.html`) mas **não** está no workspace pnpm. Volumes existentes **não** reexecutam `docker-entrypoint-initdb.d`; o runner canónico é `applyPlatformMigrations`.

Contratos públicos: `packages/contracts/src/index.ts` reexporta `src/v1/index.ts`. Entrypoint CLI: `runCommandLine`.

## 2. Diagrama textual de dependências

Setas = `package.json` `dependencies` (não transientes de teste). `contracts` é a base; omitido em cada folha.

```
apps/erp-simulator
  → (writeback HTTP; não importa kernel como lib de domínio)

platform-api
  → action-engine, api-errors, pagination, knowledge-graph, event-bus,
    entity-resolution, function-registry, object-platform, object-set,
    ontology-registry, policy-engine, explore-api
  ✗ query-api          (não é dependência do gateway)
  ✗ mcp-server         (cliente HTTP separado)

action-engine
  → object-platform, policy-engine, connector-sdk

policy-engine
  → connector-sdk, data-lineage, knowledge-graph, query-api

object-set → object-platform, api-errors, pagination
explore-api → knowledge-graph, policy-engine
query-api → contracts only (search projection; no KnowledgeGraphStore)
federation → (contracts; search-adapter para query-api)
entity-resolution → (contracts; SqlClient opcional)
function-registry → contracts, execution-sandbox, object-platform, policy-engine
ontology-registry → contracts only
knowledge-graph → object-platform, contracts
object-platform → contracts, pg
event-bus → (outbox / writeback; usado por platform-api)
connector-postgres → connector-sdk, contracts
connector-sdk → contracts
mcp-server → contracts (HTTP client; não monta PlatformContext)

Regra de direção:
  apps/*  →  packages/*
  packages/*  não importa apps/*
  connector não importa ontology-registry
```

Root `package.json` também lista `action-engine`, `contracts`, `entity-resolution`, `function-registry`, `incremental-pipeline-scheduler`, `object-platform`, `object-set`, `ontology-registry`, `platform-api` como dependencies do metapackage — não é runtime.

## 3. Fontes de verdade por conceito

### 3.1 Policy — uma API pública, um snapshot

| Camada | Símbolos | Arquivo |
|---|---|---|
| Contrato EPID | `PolicyEngine`, `AuthorizeRequest`, `AuthorizeResult`, `PolicyOperation` | `packages/contracts/src/v1/policy.ts` |
| Runtime HTTP/Actions | `PolicyRuntime` (`createPolicyRuntime`) | `packages/policy-engine/src/core/policy-runtime.ts` |
| Overlay RBAC (mesmo generation) | `PolicyOverlay` (compiler input) | `packages/policy-engine/src/core/policy-overlay.ts` + `policy_meta.overlay` (`0015`) |
| Catalog (compiler input) | `PolicyResourceCatalog` | `packages/policy-engine/src/core/policy-catalog.ts` + `policy_meta.catalog` (`0016`) |
| Overlay → EPID | `compileOverlayToEpid` | `packages/policy-engine/src/core/policy-compiler.ts` |
| Resource IDs | `ResourceIds` (`ontology + kind + id`) | `packages/policy-engine/src/core/resource-ids.ts` |
| Route policy | `declarePolicy` / `registerRoutePolicyHook` | `packages/platform-api/src/core/route-policy.ts` |
| Engine EPID | `createPolicyEngine(): HydratablePolicyEngine` | `packages/policy-engine/src/core/engine.ts` |
| Store | `PolicyStore`, `createMemoryPolicyStore` | `packages/policy-engine/src/core/policy-store.ts` |
| Store PG | `createPgPolicyStore` | `packages/policy-engine/src/core/pg-policy-store.ts` |
| SQL | `policy_nodes`, `policy_grants`, `policy_epid_tuples`, `policy_meta` | `infra/sql/0010_policy.sql`, overlay `0015_policy_overlay.sql`, catalog `0016_policy_resource_namespace.sql` |
| Fixture compiler | `createOntologyAuthorizer` / `createAllowAllTestPolicy` → `PolicyRuntime` | `packages/policy-engine/src/core/ontology-authorizer.ts` |
| Wiring | `ctx.policy` (obrigatório); `ctx.authorizer === ctx.policy`; `createPlatformRuntime` awaits migrate+snapshot+catalog | `platform-api/src/core/context.ts`, `bootstrap.ts` |
| ADR | ADR-0003, ADR-0004, ADR-0005, ADR-0008, ADR-0009 | `docs/architecture/adr/` |

`/api/v2` consulta **`ctx.policy`** (`PolicyRuntime`). Overlay `*` é expandido em compile-time contra o catálogo da geração; `authorize()` só chama o engine EPID. Interpretação de `AuthorizeResult`: `allowsMutation` / `allowsRead` / `authorizeProceeds` (ADR-0008) — `partial` nunca autoriza escrita. Overlay selectors são independentes (`actions: ['*']` não concede Functions/admin). `approverPolicy` é resource `approver:{ontology}/{name}`. Persistência: `PolicyAdmin.publishOverlay` / `publishCatalog` → `replaceSnapshot` CAS na generation; catálogo idêntico não incrementa; réplicas observam via `subscribeGeneration` / `refresh()`. Rotas de negócio declaram `{operation, resourceResolver}` no hook único; públicos: `GET|HEAD /health`, `GET|HEAD /ready`, `OPTIONS`. HEAD herda policy do GET.

Allow-all só como fixture nomeada `createAllowAllTestPolicy` / `policyFixture: 'allow-all'`. `createActionExecutor` e `createObjectPlatform` exigem `authorize`. Memória sem fixture **lança**. Postgres sem overlay carrega o store (vazio = deny).

### 3.2 Objects / Links — repositório canônico (ADR-0007)

**Canônico (runtime `/api/v2` e facades):**

| Papel | Contrato | Memory | PostgreSQL |
|---|---|---|---|
| Objects | `ObjectRepository` / `ObjectRecord` `packages/contracts/src/v1/object-repository.ts` | `createMemoryObjectRepository` `object-platform/src/core/object-repository.ts` | `createPgObjectRepository` `pg-object-repository.ts` → `platform_objects` (`0002`) |
| Links | `LinkRepository` / `LinkRecord` | `createMemoryLinkRepository` `link-repository.ts` | `createPgLinkRepository` `pg-link-repository.ts` → `platform_links` (`0002`, versionamento `0007`). Live `create` with `expectedVersion` = CAS upsert (ADR-0012); revive is `deleted=true` only. |
| History | `ObjectHistoryStore` (pacote, não contracts v1) | `createMemoryObjectHistoryStore` | `createPgObjectHistoryStore` (`0003`) |
| Projection ingest | `ProjectionWriter` `contracts/src/v1/projection.ts` | `createProjectionWriter` + `createMemoryProjectionLedger` | mesmo writer + `createPgProjectionLedger` (`0017`) |
| Ingestion pipeline | `IngestionRuntime` `contracts/src/v1/ingestion.ts` | `createIngestionRuntime` + memory store/catalog/worker | mesmo runtime + PG store/catalog (`0022`/`0023`/`0024`) + `POST /api/v2/ingest/:connectorId` |
| Governação | decorator | `createGovernedObjectRepository` envolve o memory raw (ADR-0014) | `createGovernedObjectRepository` envolve o PG raw |
| Boundary transaccional | `MemoryCheckpoint` (`capture`/`restore`) | `createMemoryTransactionBoundary` serializa cada UoW sobre objects/links/history/executions/events/audit/outbox/ledger | `txManager.transaction` + `bind(tx)` |
| Capabilities | `ObjectReader` / `ObjectWriter` / `LinkReader` / `LinkWriter` | aliases de `Pick` no contrato | idem |

`PlatformContext.objects` é o governed repo nos dois modos. `objectExists` e `cardinalityOf` dos links passam pelo governed repo e pela `OntologyVersionPolicy` — o check de existência não contorna o decorator.

**Facades (sem Maps de objects/links):**

| Facade | Símbolo | Arquivo | Quem usa |
|---|---|---|---|
| Mapping + project | `createObjectPlatform(): ObjectPlatform` — API async (ADR-0013); mapping Maps only; writes through repositories | `object-platform/src/core/platform.ts` | CLI `obj -- demo`, `tests/gates.test.ts`, `scripts/demo-sales-gd.ts` (repos partilhados) |
| Graph write-through | `createKnowledgeGraph(): KnowledgeGraphStore` — API async (ADR-0013); tickets process-local; objects/links nos repos | `knowledge-graph/src/core/store.ts` | CLI kg, classification pipeline, demo-sales (mesmos repos) |
| Índice de busca | `createQueryEngine` (`docs`, `inverted`, `searchLinks`) — projeção, não store de objects | `query-api/src/core/engine.ts` | CLI `search -- demo`; **não** montado no `platform-api`; **não** importa `knowledge-graph` |

Contrato paralelo de API: `ObjectPlatform` em `packages/contracts/src/v1/object-platform.ts` (`OntologyObject`, `project`, `query`) ≠ `ObjectRepository`. A persistência é a mesma.

Graph de leitura canônico: `createGraphQueryEngine({ objects, links })` em `knowledge-graph/src/core/graph-query.ts` — **não** possui estado. Este é o `PlatformContext.graph`.

`ObjectRepository` / `LinkRepository` devolvem sempre `Promise` e as facades são async (ADR-0013). `sync-value.ts` foi removido dos dois pacotes: uma facade não pode iniciar uma escrita PG e depois lançar por detectar Promise.

Gate estático: `scripts/tooling/storage-kernel.mjs` (via `pnpm verify:lint`) — inclui o bloqueio de reintrodução de `syncValue` / `isThenable` sobre um storage port.

### 3.3 Ontology

| Papel | Símbolo | Arquivo |
|---|---|---|
| Contrato | `OntologyRegistry`, `OntologyVersion`, `ObjectTypeDef`, `ActionTypeDef`, … | `packages/contracts/src/v1/ontology.ts` |
| ActionType schema | `validateActionTypeDefSchema` / `compilePattern` (linear-safe subset) | `packages/contracts/src/v1/action-parameter-schema.ts` (ADR-0011). Registry + executor import this; `ontology-registry` ✗ `action-engine`. |
| Memory | `createOntologyRegistry` | `ontology-registry/src/core/registry.ts` |
| PG | `createPgOntologyRegistry` | `ontology-registry/src/core/pg-registry.ts` |
| SQL | ontologies / versions | `infra/sql/0003_history_ontology.sql` |

| Decisão de versão | `createOntologyVersionPolicy` (`pin` por create/update/action/projection) | `object-platform/src/core/ontology-version-policy.ts` (ADR-0014) |
| Compatibilidade | `classifyOntologyChange` → `additive-compatible` \| `coercible` \| `breaking` \| `invalid` | `object-platform/src/core/ontology-compatibility.ts` |

Uma única autoridade responde “qual versão valida esta escrita?” (ADR-0014): o governed repository valida contra a versão gravada no registo; publicar ou fazer rollback de `latest` não reescreve objectos; nenhum caller chama `getLatestVersion()` no meio de uma operação. Objecto só muda de versão por migração declarada (`migrateToOntologyVersionId`, ADR-0015).

Invariante do contrato: mudança = nova `OntologyVersion` (nunca update in-place). Drafts PG são **session-local** (comentário em `pg-registry.ts`): work não commitado não sobrevive restart.

**ActionType:** somente `OntologyRegistry` via `ActionDefinitionResolver.resolve(ontologyId, ontologyVersionId, actionTypeId)` (ADR-0006). `ActionExecutor.registerActionType` / `getActionType` e o Map do executor foram removidos. HTTP não copia latest para o executor.

### 3.4 Actions

| Papel | Símbolo | Arquivo |
|---|---|---|
| Contrato | `ActionExecutor`, `ActionApplyRequest`, `ActionExecutionStore` | `packages/contracts/src/v1/action-runtime.ts` |
| Executor | `createActionExecutor` + `ActionDefinitionResolver` | `action-engine/src/core/executor.ts` |
| UoW | `ActionUnitOfWork`, `ActionTransactionStores` | `action-engine/src/core/types.ts` — PG: SQL tx; memory: `createSnapshotUnitOfWork` |
| Lifecycle | transition table | `action-engine/src/core/action-lifecycle.ts` |
| Envelope | `ontologyVersionId`, `actionTypeHash`, `expectedObjectVersions`, `policyGeneration` | `ActionExecution` + `0018` |
| Execuções memory | `createMemoryActionExecutionStore` | `action-engine/src/core/execution-store.ts` |
| Execuções PG | `createPgActionExecutionStore` | `action-engine/src/core/pg-execution-store.ts` |
| Eventos | `createMemoryOperationalEventStore` / `createPgOperationalEventStore` | `events.ts` / `pg-events.ts` |
| Falha visível | `createFailureSurvivingExecutor` | `failure-surviving-executor.ts` (memory e postgres) |
| Outbox na tx | `createPgOutboxRepository` | `event-bus/src/store/pg-outbox-repository.ts` |
| HTTP | `POST .../actions/{action}/validate\|apply` | `platform-api/src/routes/v2.ts` |

Produção (postgres context): `unitOfWork.run` → `txManager.transaction((tx) => fn(bind(tx)))`. Memory context passa snapshot UoW nas Actions e no ProjectionWriter. Mutating Action exige `idempotencyKey`; modify/delete/generate_document exigem `expectedObjectVersions`. Pause/resume usa a definição pinada, não latest (ADR-0006).

### 3.4d Functions (ADR-0019)

| Papel | Símbolo | Arquivo |
|---|---|---|
| Contrato | `FunctionRuntime`, `FunctionExecutionPin`, `FunctionArtifactStore` | `packages/contracts/src/v1/function-runtime.ts` |
| Runtime | `createFunctionRuntime` | `function-registry/src/core/runtime.ts` |
| Artifacts | memory / `createPgFunctionArtifactStore` | `artifact-store.ts` / `pg-artifact-store.ts` |
| Execuções | memory / `createPgFunctionExecutionStore` | `execution-store.ts` / `pg-execution-store.ts` |
| Pin | `createFunctionDefinitionResolver` | `resolver.ts` — `getLatestVersion` só em `pin()` |
| Reads | `createFunctionObjectReader` | `history.asOf(readAsOf, readSeq)` + redaction (ADR-0020/0021) |
| Worker | `createFunctionWorker` / `bin/function-worker.ts` | claim CAS, lease, `AbortSignal` |
| HTTP | `POST .../functions/{fn}/execute` → 202 | `platform-api/src/routes/functions.ts` |
| SQL | `function_artifacts`, `function_executions` (+ `read_seq`) | `0025`, `0026` |
| CLI legado | `createFunctionRegistry` | não montado no HTTP |

`runOnce` nunca resolve `latest`. Reads via `history.asOf` com fronteira `readSeq` (não `objects.get`). Mutação só via `ActionExecutor`. Isolamento real: worker_threads + vm para publishers semi-confiáveis; não é sandbox contra código hostil. Detalhe: `docs/architecture/function-runtime-2026-08-19.md`. Certificação: `docs/certification/`.

### 3.4b ProjectionWriter

| Papel | Símbolo | Arquivo |
|---|---|---|
| Contrato | `ProjectionWriter`, `ProjectObjectCommand`, `MigrateObjectCommand`, … | `packages/contracts/src/v1/projection.ts` |
| Migração declarada | `ProjectionWriter.migrateObject` (CAS + schema destino + history `from/toOntologyVersionId`) | `projection-writer.ts` (ADR-0015), `infra/sql/0021` |
| Writer | `createProjectionWriter` | `object-platform/src/core/projection-writer.ts` |
| Ledger memory | `createMemoryProjectionLedger` | `projection-ledger.ts` |
| Ledger PG | `createPgProjectionLedger` | `projection-ledger.ts` → `projection_ledger` (`0017`) |
| Wiring | `ctx.projections` | `platform-api/src/core/context.ts` (não montado em `/api/v2`) |

Capability: `ResourceIds.admin('projection')`. Identidade: `(source, ontologyId, sourceEventId)`. Outbox: o mesmo `OutboxRepository` das Actions. Sem `/internal/v1`.

Writeback: depois do COMMIT, workers em `event-bus` (`createWritebackHandler`, `createHttpWritebackConnector`, `createSqlMirrorWritebackHandler`). SqlMirror é sink de simulador, não ERP.

### 3.4c IngestionRuntime

Pipeline genérico (ADR-0016): `Connector → RawEnvelope → MappingVersion pinada → ProjectionBatch → ProjectionWriter`.

| Papel | Símbolo | Arquivo |
|---|---|---|
| Contrato | `RawEnvelope`, `ConnectorPage`, `IngestionRuntime`, `IngestionMappingPin` | `packages/contracts/src/v1/ingestion.ts` |
| Runtime | `createIngestionRuntime` | `ingestion-runtime/src/core/runtime.ts` |
| Transform | `envelopeToEffects` | `ingestion-runtime/src/core/mapping-transform.ts` |
| Store memory | `createMemoryIngestionStore` | `ingestion-store.ts` |
| Store PG | `createPgIngestionStore` / `createPgCheckpointStore` | `0022` (`ingestion_runs`, quarantine, checkpoints) + `0023` (inbox/nonce) + `0024` (mapping immutability, nonce `expires_at`) |
| Catalog | `ConnectorRegistrationRepository` / `MappingVersionRepository` | `0023` tables; `0024` SQL trigger makes `mapping_versions` immutable |
| Worker | `createIngestionWorker` / `pnpm --filter platform-api worker:ingest` | leases em `ingestion_runs` |
| HTTP adapter | `POST /api/v2/ingest/:connectorId` | `platform-api/src/routes/ingest.ts` — só `enqueueWebhook` |
| Wiring | `ctx.ingestion` + `ctx.ingestionWorker` | `platform-api/src/core/context.ts` |

Capability: `ResourceIds.admin('ingest')`. Superfície: `enqueueWebhook`, `startPull`, `runOnce`, `getRun`, `retryQuarantined`. HMAC-SHA256 sobre `timestamp + "." + nonce + "." + rawBody`; `secretRef` no catálogo, segredo no `SecretResolver`. Replay: mesmo event ID + mesmo payload + nonce novo → mesmo receipt; mesmo event ID + payload diferente → `INGESTION_EVENT_CONFLICT`; mesmo nonce → `INGESTION_NONCE_REPLAY`; timestamp expirado rejeita mesmo após purge do nonce (ADR-0018). Connectors (CSV/HTTP/webhook) só produzem envelopes. Catálogo durável de connectors/mappings (ADR-0017); `mapping_versions` é imutável no PostgreSQL (`0024`). ObjectPlatform mapping Maps são facade CLI/demo. `connector-webhook` não tem servidor HTTP. Prova de banco vazio: `pnpm verify:migrations:fresh` (`CREATE DATABASE`), não schema isolado.

### 3.5 Query — quatro superfícies

| Superfície | Entrypoint | Fonte de dados | No `/api/v2`? |
|---|---|---|---|
| ObjectSet memória | `resolveObjectSet`, `loadObjects`, `aggregateObjects` `object-set/src/core/resolver.ts` | `ObjectRepository` + `LinkRepository` | sim, se `ctx.sql` ausente |
| ObjectSet SQL | `compileObjectSet` `compile-sql.ts`; `loadObjectsPg` `resolver-pg.ts` | SQL em `platform_objects` / `platform_links` | sim, se `ctx.sql` presente |
| Graph HTTP | `executeGraphPattern` + `catalogFromRepos` | snapshot em memória dos repos | `POST .../graphPatterns/execute` |
| Catalog search | `compileCatalogSearch` `object-set/src/core/search-sql.ts` | SQL `0013_catalog_search.sql` | rotas v2 (trecho catalog) |
| Query API (Passo 29) | `createQueryEngine` | inverted index **próprio** + `KnowledgeGraphStore` default | **não** |
| Explore CLI | `seedExploreCatalog` | catálogo próprio | não (HTTP usa `catalogFromRepos`) |
| Federation | `createFederationEngine` | `TemporaryObject` / pushdown | CLI `fed -- demo`; não é o gateway |

`createSecuredReads` (`platform-api/src/core/secured-reads.ts`) é a porta de leitura HTTP para get/list/links/ObjectSet/aggregate. Deny de ObjectType → `{ data: [] }` no load (não 403). Get-by-id usa `ReadForbiddenError` → 403.

### 3.5b AIP — read-only NL + agent propose + eval (Passo 35–37 / ADR-0022–0024)

| Peça | Contrato / API | Runtime | Montado em `/api/v2`? |
|---|---|---|---|
| Ask | `AipAskRequest` / `AipAskResponse` | `createAiGateway` (`aip-gateway`) | `POST .../aip/ask` |
| Agent run | `AipAgentRunRequest` / `AipAgentRunResponse` | `createAiAgent` state-machine | `POST .../aip/agent/run` |
| Eval | `AipEvalCase` / `AipEvalSuiteResult` | `runAipEvalSuite` (`aip-eval`) | CLI `pnpm aip-eval` (não HTTP) |
| LLM port | `LlmProvider` | MockLlm (dev/test) / OpenAI-compatible adapter | — |
| Tools | `AipToolDefinition` risk=`read`\|`propose` | reads + `validate_action`/`propose_action` | in-process |
| Reads | `AipObjectReader` | `createAipObjectReader` → SecuredReads + links | — |
| Mutations | `AipActionPort` | `ctx.actions.validate` / `apply` only | approve via `/actions/executions/:id/approve` |

Invariante: LLM não muta Objects/Links fora de `ActionExecutor`. `ask` permanece read-only. Eval não aplica patches automaticamente (ADR-0024). Produção sem `AIP_LLM_*` → fail-closed.

### 3.6 Persistence

| Recurso | Memory (test double) | PostgreSQL | Migration |
|---|---|---|---|
| Objects/Links | Maps em process | `createPgObjectRepository` / `createPgLinkRepository` | `0002`, `0007`, `0009` |
| Object history | `createMemoryObjectHistoryStore` | `createPgObjectHistoryStore` | `0003`, `0021` (colunas de migração) |
| Ontology | Maps | `createPgOntologyRegistry` | `0003` |
| Action executions | Map | `createPgActionExecutionStore` | `0002`, `0011` |
| Projection ledger | Map + waiters | `createPgProjectionLedger` | `0017` |
| Operational events | Map | `createPgOperationalEventStore` | `0002` |
| Audit | `createAuditLog` sem repo / memory repo | `createPgAuditRepository` | `0004` |
| Policy EPID | `createMemoryPolicyStore` | `createPgPolicyStore` | `0010` |
| Outbox | `createMemoryOutboxRepository` (insert + OutboxDispatcher) | `createPgOutboxRepository` (insert + OutboxDispatcher); `PostgresOutboxStore` CLI-only | `0001`, `0008` |
| ER ledger | `createMemoryEntityLedger` | `createPgEntityLedger` (se `sql` no `createEntityResolver`) | `0006`, `0014` |
| Functions | `FunctionRuntime` + memory artifact/execution stores; `createFunctionRegistry` é CLI/demo | `createPgFunctionArtifactStore` / `createPgFunctionExecutionStore` | `0025` |
| Datasets / HPP | `MemoryBlobStore` / `FsBlobStore` | não no `PlatformContext` | — |
| Ingestion runs / quarantine / inbox | `createMemoryIngestionStore` | `createPgIngestionStore` | `0022`, `0023` |
| Checkpoints connector | `createMemoryCheckpointStore` | `createPgCheckpointStore` | `0022` |
| Connector registrations | `createMemoryConnectorRegistrationRepository` | `createPgConnectorRegistrationRepository` | `0023` |
| Mapping versions (ingest) | `createMemoryMappingVersionRepository` | `createPgMappingVersionRepository` | `0023`, trigger `0024` |

Dois caminhos de schema:

1. `docker-compose` initdb: arquivos `0001`–`0013` (não `0014`).
2. `applyPlatformMigrations`: lê `infra/sql/*.sql` com checksum SHA-256 + advisory lock.

Initdb só corre em volume vazio. Runtime de API **não** chama `applyPlatformMigrations` dentro de `createPostgresPlatformContext` (só o helper `createPgSqlClient` + testes isolados).

## 4. Interfaces públicas (o que um consumidor deve usar)

### 4.1 Contratos v1 (`packages/contracts/src/v1/index.ts`)

Grupo relevante ao kernel operacional:

- Ingestão: `CanonicalEvent`, `Connector`
- Memória imutável: `DatasetStore`, delta-tree, `TimeTravelStore`
- Transform / DQ / sandbox / lineage
- Policy: `PolicyEngine`, classification, noninterference, `AuditRepository`
- Ontology + ObjectSet AST
- Objects: `ObjectRepository`, `LinkRepository`
- Ingestão de objeto: `ProjectionWriter` (não é HTTP)
- Pipeline de ingestão: `IngestionRuntime` (`RawEnvelope` → mapping pin → `ProjectionBatch`); catálogo `ConnectorRegistration` / `MappingVersionRepository`
- Actions: `ActionExecutor`
- Functions: `FunctionRuntime` (`create` / `get` / `cancel` / `runOnce`); `FunctionRegistry` é legado CLI
- Parallel (legado de passo): `ObjectPlatform`, `KnowledgeGraphStore`, search, explore, federation, edge, offline, replication

### 4.2 Factories de pacote (entrypoints)

| Pacote | Público intencional |
|---|---|
| `platform-api` | `createMemoryPlatformContext`, `createPostgresPlatformContext`, `createPlatformRuntime`, `createPlatformServer`, `registerV2Routes`, `registerAipRoutes`, `createSecuredReads`, `createAipObjectReader`, `createHmacTokenVerifier`, `createJwksProvider` |
| `aip-gateway` | `createAiGateway`, `createAiAgent`, `createMockLlm`, `createOpenAiCompatibleLlm` |
| `aip-eval` | `runAipEvalSuite`, `analyzeEvalFailure`, `buildCanonicalAipEvalSuite` |
| `policy-engine` | `createPolicyRuntime`, `createPolicyEngine`, `createOntologyAuthorizer` (fixture), `createPgPolicyStore`, `ResourceIds`, `createPgAuditRepository` |
| `object-platform` | repos memory/PG, `createGovernedObjectRepository`, `createGraphQueryEngine` vive em knowledge-graph, `applyPlatformMigrations`, **e ainda** `createObjectPlatform` |
| `ontology-registry` | `createOntologyRegistry`, `createPgOntologyRegistry` |
| `action-engine` | `createActionExecutor`, stores, `createFailureSurvivingExecutor` |
| `object-set` | `resolveObjectSet`, `compile-*`, `createPgObjectSetResolver` |
| `query-api` | `createQueryEngine` |
| `explore-api` | `executeGraphPattern`, `catalogFromRepos` |
| `knowledge-graph` | `createGraphQueryEngine` (canônico) **e** `createKnowledgeGraph` (adapter sobre repos) |
| `function-registry` | `createFunctionRuntime`, PG/memory stores, worker; `createFunctionRegistry` CLI/demo |
| `ingestion-runtime` | `createIngestionRuntime`, `createIngestionWorker`, `sourceFromConnectorV2`, catalog adapters |
| `event-bus` | `createPgOutboxRepository`, worker, writeback connectors |
| `mcp-server` | `createMcpServer`, tools `listObjectTypes` / `getObject` / `searchObjects` / `listActions` / `applyAction` |

### 4.3 HTTP `/api/v2` (`registerV2Routes`)

```
/health  /ready
/api/v2/ontologies
/api/v2/ontologies/{ontology}
/api/v2/ontologies/{ontology}/latestVersion
/api/v2/ontologies/{ontology}/objectTypes
/api/v2/ontologies/{ontology}/objects/{objectType}
/api/v2/ontologies/{ontology}/objects/{objectType}/{primaryKey}     GET; PUT/DELETE = 405 ACTION_REQUIRED
/api/v2/ontologies/{ontology}/objects/{objectType}                 GET; POST = 405 ACTION_REQUIRED
/api/v2/ontologies/{ontology}/objects/{objectType}/{pk}/links/{linkType}  GET; POST = 405 ACTION_REQUIRED
/api/v2/ontologies/{ontology}/objectSets/loadObjects
/api/v2/ontologies/{ontology}/objectSets/aggregate
/api/v2/ontologies/{ontology}/graphPatterns/execute
/api/v2/ontologies/{ontology}/actionTypes                          GET + POST
/api/v2/ontologies/{ontology}/actions/{action}/validate
/api/v2/ontologies/{ontology}/actions/{action}/apply
POST /api/v2/ingest/{connectorId}   HMAC ingress (ADR-0017); 202 após enqueueWebhook
POST /api/v2/ontologies/{ontology}/functions/{fn}/execute   202 FunctionRuntime.create
GET  /api/v2/ontologies/{ontology}/function-executions/{id}
POST /api/v2/ontologies/{ontology}/function-executions/{id}/cancel
(+ rotas ER: registerErRoutes)
```

Tombstones POST/PUT/DELETE objects e POST links: `405 ACTION_REQUIRED`. Handlers não chamam repositories. Ingest HTTP é adapter fino: `enqueueWebhook` → `IngestionRuntime` → `ProjectionWriter` (ADR-0017 / ADR-0016 / ADR-0005). `connector-webhook` não expõe HTTP.

## 5. Caminhos que acessam stores crus

“Cru” = `ObjectRepository` / `LinkRepository` / SQL / Maps internas **sem** passar por Action + SecuredReads.

| Caminho | O que toca | Arquivo |
|---|---|---|
| POST/PUT/DELETE objects, POST links | tombstone 405 — **não** toca repository | `routes/v2.ts` |
| ProjectionWriter | `ctx.projections` (composition root interno) | `context.ts`, `projection-writer.ts` |
| IngestionRuntime | `ctx.ingestion` → `ProjectionWriter`; HTTP só `enqueueWebhook` | `ingestion-runtime`, `routes/ingest.ts` |
| POST actionTypes | `ctx.ontology.openDraft` + `addActionType` + `commit` (não toca o executor) | `routes/v2.ts` |
| Catalog search na v2 | `ctx.objects.list` direto em trechos | `routes/v2.ts` (~510, ~554) |
| Functions | `ctx.functions` (`FunctionRuntime`); handler não toca repository/sandbox/SQL | `routes/functions.ts` |
| Graph pattern | `catalogFromRepos({ objects: ctx.objects, links: ctx.links })` — lista raw, redaction só no pattern | `routes/v2.ts`, `explore-api/src/core/from-repos.ts` |
| Link existence check | `rawObjects.get` (não governed) | `context.ts` `bind()` |
| Projector legado | mapping Maps; objects/links nos repositories | `object-platform/src/core/platform.ts` |
| KG legado | tickets process-local; objects/links nos repositories | `knowledge-graph/src/core/store.ts` |
| Query engine | `docs` + `inverted` + `searchLinks` (projeção de busca) | `query-api/src/core/engine.ts` |
| ActionExecutor | `defaultStores.objects` dentro da UoW (intencional — é a porta de mutação) | `executor.ts` |
| SecuredReads.get/list | `ctx.objects` depois filtra/redact | `secured-reads.ts` |
| ObjectSet PG | SQL direto `platform_objects` | `compile-sql.ts`, `resolver-pg.ts` |
| Outbox worker | `outbox_events` | `event-bus/src/worker/outbox-worker.ts` |
| CLI demos | cada pacote monta stores próprios | `packages/*/src/cli.ts` |
| `scripts/demo-sales-gd.ts` | `createObjectPlatform` + `createKnowledgeGraph` nos **mesmos** repos | fora do PlatformContext |

`createSecuredReads` documenta: *“Raw `ctx.objects` stays unredacted for Actions + projector.”* Handlers públicos recebem `PublicPlatformContext` (leitores).

## 6. Memória vs PostgreSQL (paridade real)

| Invariante | Memory context | Postgres context |
|---|---|---|
| Relógio/IDs | determinístico por default | `createSystemClock` / `createUuidIdGenerator` |
| Policy | `ctx.policy` obrigatório; allow-all só fixture nomeada | `createPolicyRuntime` awaited; overlay vazio = deny |
| Ontology validation na escrita | sim, mesmo `createGovernedObjectRepository` | sim, `governanceMode` default `enforce` |
| History na mesma tx | governed repo escreve history e participa da mesma boundary | governed repo escreve history via mesmo `SqlClient` |
| UnitOfWork / rollback | `createMemoryTransactionBoundary`: UoW serializado, rollback só da transacção que falhou | `transaction` + `bind(tx)` |
| Migração de OntologyVersion | `migrateObject` com CAS e idempotência | idem, mais durabilidade a restart |
| Outbox | `createMemoryOutboxRepository` no context | `createPgOutboxRepository` na tx |
| Failure surviving execution | `createFailureSurvivingExecutor` | `createFailureSurvivingExecutor` |
| ObjectSet | oráculo in-process | `compile-sql` + `ctx.sql` |
| ER | ledger memory | ledger PG se `sql` passado |
| Functions | memory stores (test double) | PG artifacts + executions (`0025`); pin + hash; worker claim |
| `/ready` | 200 se `ctx.ready` | 503 até policy+seed; 200 depois |

Conclusão: a suite `governed-storage-contract` (`packages/platform-api/tests/governed-storage-contract.ts`) e a suite de evolução (`packages/platform-api/tests/ontology-evolution.ts`) correm nos dois adapters sem ramo por modo. As diferenças permitidas são persistência/restart e a implementação do adapter: só o runner PG prova durabilidade após restart e concorrência real de migração. Action UoW + envelope + failure-surviving são paritários (ADR-0006). Policy partilha o contrato `PolicyRuntime`.

`createPlatformServer` exige `ctx.policy`. Produção: `NODE_ENV=production` exige JWKS ou JWT secret; `PLATFORM_MODE=postgres` recusa context memory.

## 7. Módulos: production, test-only, experimental

Classificação prática (não apagar experimentais). `pnpm gate:core` é o caminho crítico CI-rápido; CI completo ainda roda todos os `test` do turbo.

### Production / critical path

Usados por `createPostgresPlatformContext` + `createPlatformServer` + workers:

`contracts`, `api-errors`, `pagination`, `object-platform` (repos/PG/governed/migrations), `ontology-registry`, `object-set`, `knowledge-graph` (`GraphQueryEngine` only no context), `action-engine`, `policy-engine` (authorizer + audit PG + policy store), `event-bus` (outbox/writeback), `entity-resolution` (com sql), `function-registry` (`FunctionRuntime` + PG `0025`, ADR-0019), `platform-api`, `aip-gateway` (Passo 35 read-only), `observability` (gate bloco 1), `connector-sdk`, `connector-postgres`, `ingestion-runtime`, `connector-csv`, `connector-http`, `connector-webhook`.

HTTP opcional mas shipped: `explore-api` (graphPatterns), rotas ER/functions.

### Test-only / test doubles

| Símbolo | Uso |
|---|---|
| `createMemory*` (repos, events, executions, outbox, policy store, audit, checkpoint, sql client) | testes e CLI demo |
| `createMemoryPlatformContext` / `createPlatformContext` | testes HTTP |
| `policyFixture: 'allow-all'` | testes HTTP e demo CLI nomeada |
| `createMockWritebackConnector`, `createSqlMirrorWritebackHandler` | testes / simulador |
| `createMemoryFederatedConnector`, `createMemoryEdgeConnector` | demos passos 31–32 |
| `tryOpenIsolatedPg` / `openIsolatedPg` | integração PG; opcional vs obrigatória. Auth/config não viram “banco ausente” |
| `apps/erp-simulator` | sink de writeback; não é ERP |
| `connector-acceptance-tests` | CAT |
| `InMemoryJobQueue`, `InMemoryTransactionalStore` | gates event-bus |

### Experimental / support / não no gateway

Não bloquear `gate:core` se quebrarem, mas o script atual **inclui** query/explore/federation/edge/offline/replication no `gate:core` (ver `package.json`). Há divergência com a tabela “OPTIONAL” de `docs/architecture.md`.

| Pacote | Papel hoje |
|---|---|
| `query-api` | índice ACL próprio; CLI `pnpm search` |
| `federation` | T1.5 TemporaryObject; CLI `pnpm fed` |
| `edge-control` | subscribe → CanonicalEvent; CLI `pnpm edge` |
| `replication` | CLI `pnpm repl` |
| `offline-sync` | CLI `pnpm offline` |
| `mcp-server` | tools MCP sobre HTTP |
| `history-preserving-pipeline`, `delta-storage`, `multi-row-transactions` | memória imutável / time-travel (não no PlatformContext) |
| `transformation-runner`, `incremental-pipeline-scheduler`, `data-quality`, `execution-sandbox`, `schema-registry`, `data-lineage` | blocos 2–5; lineage é dep de policy-engine |
| `connector-http`, `connector-csv`, `connector-webhook` | envelopes apenas; não conhecem ProjectionWriter |
| `ingestion-runtime` | pipeline Connector → pin → ProjectionWriter (ADR-0016) |
| `ldpc-transceiver`, `periodic-search-manager`, `fair-query-scheduler`, `bounded-fair-scheduler` | suporte bloco 1 |
| `link-consistency-validator`, `entity-assignment-debugger`, `validation-result-notifier`, `cli-script-debugger` | patentes de suporte |
| `inline-tag-sync`, `external-content-exporter`, `tagging-interface-panel` | tagging |
| `iam-auth-monitoring`, `security-config-secrets` | Passo 3; **não** wired no TokenVerifier |
| `common-build-system`, `dynamic-documentation`, `auto-logging-config`, `metrics-collection` | fundação |
| `apps/console` | UI estática; fora do workspace |

## 8. Bootstrap assíncrono

`createPlatformRuntime` / `createPostgresPlatformContext` (async):

```
validate config → open sql → applyPlatformMigrations → validate policy schema
  → await createPolicyRuntime (store snapshot + LISTEN)
  → await catalog sync (idêntico não bumpa)
  → await seed
  → ctx.ready = true
  → listen
```

Falha fecha recursos abertos pelo factory e não chama `listen`. `/health` = processo vivo. `/ready` = 200 somente `ctx.ready` e `!ctx.policy.degraded()`.

CLI: sem principals hardcoded. `PLATFORM_POLICY_FIXTURE=allow-all` é o escape hatch nomeado de demo.

## 9. Decisões ainda abertas

Listadas de propósito. Nenhuma está fechada por este documento.

1. **Fechada (ADR-0003 + ADR-0004 + ADR-0008):** `PolicyRuntime` sobre `PolicyEngine`/EPID. Overlay `*` compila para nós EPID contra o catálogo da geração. `partial` não autoriza mutação. Toda rota de negócio declara policy; HEAD não é público.
2. **Parcial (ADR-0007 + ADR-0016 + ADR-0017):** `createObjectPlatform` é facade de mapping sobre `ObjectRepository`. Mapping Maps permanecem process-local para CLI/demo. O catálogo de ingestão é `MappingVersionRepository` / `ConnectorRegistrationRepository` (`0023`). O pin do `IngestionRun` é durável e `runOnce` não chama `getLatest`.
3. **Parcial (ADR-0007 + ADR-0013):** `createKnowledgeGraph` deixa de possuir objects/links e é async; tickets remote-ref continuam process-local. `GraphQueryEngine` continua a leitura canónica.
4. `query-api` vira adapter sobre ObjectSet/repos ou índice durável separado? Hoje é projeção `SearchDocument` sem KG; não está no gateway.
5. **Fechada (ADR-0005 + ADR-0016 + ADR-0017):** POST/PUT/DELETE objects/links públicos são tombstones 405. Envelopes entram por `IngestionRuntime` (`POST /api/v2/ingest/:connectorId` é adapter HMAC). A escrita de objeto é `ProjectionWriter`. Worker separado chama `runOnce`.
6. **Fechada (ADR-0006):** `ActionExecutor` lê `ActionTypeDef` só da `OntologyRegistry` via `ActionDefinitionResolver`. Envelope pinado; resume não usa latest.
7. **Fechada (ADR-0013 + ADR-0014 + ADR-0015):** memory recebe `createGovernedObjectRepository` e uma boundary transaccional real (`createMemoryTransactionBoundary`); governação, decisão de versão e migração declarada são o mesmo código nos dois adapters. Diferença permitida: persistência/restart.
8. **Fechada (ADR-0009):** bootstrap awaits migrate+policy snapshot+catalog; `ctx.authorizer === ctx.policy`; `/ready` 200 só com `ctx.ready && !degraded()`.
9. Produção auth: JWKS/`IdentityProvider` (Passo 3) vs HS256 `PLATFORM_JWT_SECRET` (hoje o swap point avisa, mas HS256 ainda é aceito em production se o secret existe).
10. **Fechada (ADR-0021):** outbox de produção = `OutboxRepository` + `OutboxDispatcher` sobre `outbox_events`. `PostgresOutboxStore` é CLI.
11. Fábricas `Clock`/`IdGenerator` copiadas em object-platform, policy-engine, query-api, explore-api, federation, connector-sdk, action-engine.
12. `OntologyObjectService` (P7–P8 no audit) ainda é o nome da porta de mutação, ou `ActionExecutor` já é essa porta?
13. **Fechada (ADR-0019):** `FunctionRuntime` é a autoridade; artifacts/executions PG (`0025`). `createFunctionRegistry` é CLI/demo.
14. **Parcial:** hidden-miss em SecuredReads (lista vazia / get undefined / aggregate 0). `PolicyEngine.securedRead` no grafo EPID nativo permanece aparte.
15. Compose initdb vs `applyPlatformMigrations`; inclusão de `0014` no compose.
16. **Fechada (ADR-0009):** `createPostgresPlatformContext` aplica `applyPlatformMigrations` antes do snapshot.
17. Draft de ontology durável ou continua session-local?
18. Federation `TemporaryObject` promove para `ObjectRepository` por Action, ou é só demo?
19. `mcp-server.searchObjects` contra qual query surface?
20. `gate:core` vs lista OPTIONAL de `docs/architecture.md` — qual conjunto é o contrato do CI rápido?
21. **Fechada (ADR-0003):** `PolicyAdmin.replaceSnapshot` falha visível; engine enqueue sem `console.error`.
22. **Fechada (ADR-0006):** `createFailureSurvivingExecutor` na memória e no postgres; FAILED/DENIED fora da transação.
23. **Fechada:** CLI não semeia `lucca`; overlay vem do store ou `PLATFORM_POLICY_FIXTURE`.

## 10. O que este mapa não afirma

- Que P0 (Maps do `createObjectPlatform`) está fechado — **fechado para objects/links** (ADR-0007). Mapping Maps do ObjectPlatform continuam facade CLI; o catálogo de ingestão é `0023` (ADR-0017). Search index permanece projeção.
- Que memória ≡ PostgreSQL em durabilidade — **não equivale**: restart só é provado no runner PG. Regras de governação, CAS, history, provenance, cardinalidade, rollback e migração de versão correm na mesma suite nos dois adapters (ADR-0007, ADR-0014, ADR-0015).
- Que os tombstones HTTP 405 já foram removidos — **não**.
