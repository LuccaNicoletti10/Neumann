# Arquitetura-alvo do kernel Neumann

Destino de convergência. Não é o estado do código. Cada passo de runtime em direção a este alvo exige testes negativos/invariantes e, se tocar contrato público, um ADR em `docs/architecture/adr/`.

Estado de partida: [`current-state.md`](./current-state.md). Constituição: `.cursor/rules/neumann-engineering.mdc`.

## 1. Tese

Uma plataforma, uma verdade por conceito, um adaptador durável por store, um test double equivalente.

```
CONNECTORS  →  CanonicalEvent / Dataset versions / lineage
            →  OntologyRegistry (SEMÂNTICA)
            →  ObjectRepository + LinkRepository  (única instância viva)
            →  ObjectSet / GraphQuery / AIP ask (leitura; LLM = adapter)
            →  ActionExecutor          (única porta de mutação)
            →  audit + outbox + history na mesma transação
            →  writeback workers
            →  re-ingest
```

Aplicações em `apps/` consomem `/api/v2` (ou o client gerado). `packages/` não conhece o domínio da empresa.

## 2. Uma policy

**Alvo:** um único módulo de autorização com a interface estreita do contrato `PolicyEngine` (`authorize`, `securedRead`, `securityMatrix`, admissions de create).

- `AuthorizeRequest` / `AuthorizeResult` são o único shape que Actions, Reads, ObjectSets, graph, search, AIP tools e MCP usam.
- Papéis declarativos (o que hoje é `OntologyAuthorizer`) viram **conteúdo** hidratado no `PolicyStore` (grants, nós, classificação), não uma segunda API pública.
- HTTP não ramifica `if (ctx.authorizer) … else allow`. Fail-closed em produção; memória de teste injeta a **mesma** interface com fixture explícita (nunca `allowAll` implícito em código de produto).
- `AuthorizeFn` avulso deixa de ser opção paralela. Se o executor precisa de uma função, é `policy.authorize.bind(policy)`.
- Persistência de policy falha visível: sem `catch` + `console.error` como durabilidade. Hydrate é parte do bootstrap (secção 4).
- Hidden miss / noninterference aplicam-se à superfície HTTP, não só à suíte CLI do policy-engine.

**Não fazer no caminho:** wrapper `OntologyAuthorizer` que chama `PolicyEngine` e outro que não chama; três recursos (`action:`, `object:`, EPID) com semânticas divergentes sem tabela única de resource ids.

Decisão de modelagem (ainda aberta no current-state): como mapear `action:<apiName>` e `object:<objectTypeId>` para o grafo EPID. Resolver por ADR antes de apagar `createOntologyAuthorizer`.

## 3. Uma object platform

**Alvo:** `ObjectRecord` + `ObjectRepository` / `LinkRepository` são o único estado vivo de objetos e links.

```
                    ┌─────────────────────────────┐
   projector        │ ObjectRepository            │
   (dataset→obj) ──►│ LinkRepository              │◄── ActionExecutor (write)
                    │ ObjectHistoryStore          │
                    └──────────┬──────────────────┘
                               │ read
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ObjectSet         GraphQuery        Search index
        (algebra)         Engine            (se existir: projeção, não store)
```

- `createObjectPlatform` deixa de ser um store. Vira projector: lê dataset versionado, valida mapping contra `OntologyVersion`, escreve nos repositórios (via Action de sistema ou UoW de projeção auditada).
- `createKnowledgeGraph` deixa de possuir Maps. `GraphQueryEngine` sobre os repos é o grafo.
- `OntologyObject` / `GraphObject` / `SearchDocument` / `TemporaryObject` são **visões** ou DTOs, não identidades paralelas. Conversão na borda.
- Governação (`createGovernedObjectRepository`) aplica-se a **todo** adapter, inclusive memória: ontologia commitada é lei.
- `OntologyObjectService` (se o nome sobreviver) é fachada estreita de leitura/escrita governada — não um terceiro repositório. Preferência: não criar o nome se `ObjectRepository` governado + Actions já cobrem o contrato.

## 4. Bootstrap assíncrono

**Alvo:** o processo não aceita tráfego de negócio enquanto as dependências duráveis não estiverem prontas.

```
listen sockets (opcional, só /health)
  → open SqlClient (fail-fast sem DATABASE_URL)
  → applyPlatformMigrations (checksum; lock)
  → hydrate PolicyStore
  → hydrate OntologyRegistry pointers if needed
  → /ready = true
  → register rotas de negócio
```

- `policyReady` (ou sucessor) é `await`ed. `/ready` reflete o estado; `/health` pode ser liveness sem readiness.
- `createPostgresPlatformContext` ou vira `async`, ou devolve um handle cujo `start()` é async. Não devolver um context que mente “pronto”.
- `seed()` de demo não corre em produção. Fixtures de app vivem em `apps/` ou `pnpm … -- demo`.
- Relógio/IDs: produção system/uuid; testes injetam. Uma fábrica compartilhada, não sete cópias.

## 5. Actions como única porta de mutação

**Alvo:** toda mudança de objeto, link, action type efetivo, ou efeito colateral de negócio passa por `ActionExecutor.apply`.

Ciclo:

```
authorize(policy)
  → validate(params, ontology)
  → submission criteria
  → UnitOfWork:
       rules (create/modify/delete object|link)
       object history snapshot
       operational events
       audit append
       outbox insert
       execution record (inclui FAILED)
  → COMMIT
writeback workers (HTTP/SQL fora da tx, Idempotency-Key)
```

- HTTP POST/PUT/DELETE `/objects` e `/links` desaparece da API pública. Projeção usa Action de serviço ou uma porta interna não montada no Fastify público.
- `registerActionType` some: o executor resolve `ActionTypeDef` da `OntologyRegistry` (versão commitada). Draft não é executável.
- Idempotency key + `expectedObjectVersions` obrigatórios em Actions que mutam.
- Memória implementa UoW com rollback semântico (clone/commit) para o test double ser equivalente. Onde isso for mentira, o teste é PG.
- Functions permanecem puras (`invokePure`). Function que “escreve” é Action, não Function.

## 6. Adapters duráveis

**Alvo:** cada porta de persistência tem exatamente dois adapters: PostgreSQL (produção) e memória (teste), com a **mesma interface**.

| Porta | Produção | Teste |
|---|---|---|
| Objects/Links/History | PG | memory governada |
| Ontology | `createPgOntologyRegistry` | `createOntologyRegistry` |
| Policy | `createPgPolicyStore` | `createMemoryPolicyStore` |
| Audit | `createPgAuditRepository` | memory repo |
| Action executions / events | PG | memory |
| Outbox | um único `OutboxRepository` PG | memory equivalente |
| ER ledger | PG | memory |
| Functions (se duráveis) | PG ou “não durar” explícito no ADR | memory |
| Datasets / blobs | store versionado (hoje HPP FS/memory; upgrade de blob é ADR) | memory |

Regras:

- Nenhum adapter PG cai para memória. Nenhum “se DATABASE_URL falta, segue”.
- Um outbox. `PostgresOutboxStore` e `createPgOutboxRepository` não coexistem como APIs de produto.
- Search, se existir, é projeção rebuildable dos repos (ou SQL GIN já em `0009`/`0013`), não terceira verdade.
- Federation `TemporaryObject` não entra no ObjectRepository sem Action de promoção.
- Connectors não conhecem ontology; writeback não escreve no ObjectRepository — escreve na fonte externa; o kernel reingesta.

## 7. Query

**Alvo:** uma álgebra de leitura.

- ObjectSet (`BASE | FILTER | UNION | INTERSECT | SUBTRACT | STATIC | SEARCH_AROUND`) é a API de conjunto.
- Planner: memória = oráculo; PG = `compile-sql`. Paridade é gate, não desejo.
- Graph patterns e catalog search compilam para a mesma verdade (repos / SQL), com policy na porta (`securedRead` / redact).
- `query-api` ou (a) torna-se planner/index **sobre** essa verdade, ou (b) permanece pacote experimental fora do gateway — ADR escolhe, não os dois no `/api/v2`.

## 8. Camadas e profundidade (APoSD)

Módulos profundos desejados:

| Módulo | Interface estreita | Esconde |
|---|---|---|
| Policy | `PolicyEngine` | grafo EPID, grants, classificação |
| Objects | `ObjectRepository` / `LinkRepository` | SQL, CAS, soft-delete, history |
| Ontology | `OntologyRegistry` | draft/commit/hash |
| Actions | `ActionExecutor` | UoW, outbox, templates, workflow |
| Ingest | `IngestionRuntime` | connector, mapping pin, lease, quarantine, ProjectionWriter |
| Query | `loadObjects` / `aggregate` / `executeGraphPattern` | SQL vs memória |
| Context | `createPostgresPlatformContext` / `createMemoryPlatformContext` | wiring |

Proibido no alvo: `createPlatformContext` ambíguo; decorator que avisa e deixa passar (`governanceMode: 'warn'`) como default de produção; dual export do mesmo conceito.

## 9. Apps e domínio

- `packages/` genérico.
- Ontologias de empresa, ActionTypes de negócio, mappings de dataset, papéis nomeados: `apps/*`, fixtures, ou config carregada no bootstrap — não hardcoded em `platform-api/src/cli.ts`.
- `apps/erp-simulator` continua simulador. ERP real é connector + writeback.

## 10. Sequência de convergência (não é cronograma)

Ordem sugerida para não criar mais gêmeos enquanto se remove os atuais. Cada item = ADR se contrato mudar + testes.

1. Bootstrap async + `/ready` honesto + migrations no startup PG.
2. Policy única no HTTP (authorizer vira store do `PolicyEngine`, ou o contrário — uma escolha).
3. Governação + UoW equivalentes na memória, ou testes de mutação só em PG isolado.
4. Executor lê ActionTypes da ontology; Map interno some.
5. Projector `ObjectPlatform` escreve nos repos; Maps privadas saem do caminho de produto.
6. `GraphQueryEngine` único; `createKnowledgeGraph` demo-only ou removido.
7. Decisão query-api / search.
8. Remoção das rotas HTTP de write direto (depois de o projector não depender delas).
9. Um outbox (`OutboxDispatcher`), Clock/Id canónicos, Functions duráveis + `readSeq` (ADR-0021).
10. `pnpm gate:certification` + `pnpm verify:production` verdes.

Não avançar Passo 38+ (E2E closed-loop) / apps verticais / nova superfície de write enquanto 1–4 e a paridade de mutação estiverem abertos. AIP Degrau 1–3 (ADR-0022/0023/0024): ask + agent propose + eval adversariais — não segunda store nem auto-fix de código.

## 11. Critério de chegada (gates)

Nada disto está verde só porque está escrito aqui.

- `git grep` de `createObjectPlatform` / `createKnowledgeGraph` fora de CLI demo e testes do próprio legado → vazio no `platform-api`.
- Uma implementação de `authorize` no caminho `/api/v2`.
- `createPostgresPlatformContext` recusa servir se hydrate/migrations falham.
- Restart PG: ontology, objects, links, executions, audit, policy, outbox intactos.
- Mesma suíte de invariantes de Action (idempotency, rollback, deny) em memory **ou** declaração explícita “mutação só PG” nos testes do gateway.
- `pnpm gate:core`, `pnpm gate:objectset-parity`, `pnpm gate:certification`, `pnpm verify:production` verdes.
- Zero `console.error` em caminho de persistência de produto.
