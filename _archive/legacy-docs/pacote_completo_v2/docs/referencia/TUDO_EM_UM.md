# TUDO-EM-UM — BLUEPRINT + ARQUIVOS DO PROJETO
## Abra este arquivo no Cursor. Ele contém: (1) instruções de início do zero, (2) os arquivos prontos para criar no repo, (3) a blueprint técnica completa.

---

# COMO COMEÇAR DO ZERO (5 passos)

**SIM, você começa do zero.** Passo a passo:

1. Crie a pasta do projeto e abra no Cursor:
   ```bash
   mkdir platform && cd platform && pnpm init && cursor .
   ```
2. Crie os 5 arquivos da seção "ARQUIVOS DO PROJETO" abaixo (cada um tem o caminho exato).
   Dica: peça ao Cursor — "leia a seção ARQUIVOS DO PROJETO do arquivo TUDO_EM_UM.md e crie cada arquivo no caminho indicado".
3. Salve ESTE arquivo como `TUDO_EM_UM.md` na raiz do projeto (o Cursor usa como contexto).
4. Abra `TAREFA_ATUAL.md` e cole o prompt dele no chat do Cursor.
5. Execute 1 task por vez: "Execute a task 001" → revise → testes verdes → commit → próxima.

**Regras que nunca quebrar:**
- IA não mexe em `packages/contracts/` sem propor ADR
- Migration SQL: revise linha por linha
- Nunca feche sessão com teste vermelho

**Sua rota:** M0 → M1 → M2 → M3 → M4 (aqui o produto já funciona ponta a ponta). Resto é evolução.

---

# ARQUIVOS DO PROJETO (criar no repo)

## ARQUIVO: `.cursor/rules/contracts.mdc`

```markdown
---
description: Regras de contratos — SEMPRE aplicar
alwaysApply: true
---
# CONTRATOS SÃO INTANGÍVEIS

1. Tudo em `packages/contracts/v1/` é IMUTÁVEL dentro de uma release.
2. Se uma task parecer exigir mudança de contrato: PARE. Não edite. Proponha um ADR em `docs/adr/` e aguarde decisão.
3. Implementações importam tipos SOMENTE de `@platform/contracts`. Nunca importe `internals/` de outro módulo.
4. Todo contrato tem golden fixtures em `packages/testing`. Se o shape mudar, o CI quebra — isso é intencional.
5. Prompts de implementação devem citar o contrato: "implemente X conforme packages/contracts/v1/<arquivo>.ts, sem alterar a interface".

```

## ARQUIVO: `.cursor/rules/architecture.mdc`

```markdown
---
description: Arquitetura e invariantes — SEMPRE aplicar
alwaysApply: true
---
# ARQUITETURA (ordem corrigida M0–M9)

O loop do produto: SOURCE → CONNECT → VERSION → TRANSFORM → LINEAGE → RESOLVE → ONTOLOGY → FUNCTION → ACTION → WRITE-BACK → (fonte muda) → novo evento.

## Invariantes (todo código deve respeitar)
- Todo evento/log carrega `principal`, `trace_id`, `policy_tags`.
- Versão de dataset commitada é IMUTÁVEL; alteração = nova versão com parentVersion.
- Toda leitura de objeto passa por `PolicyEngine.authorize()`. Sem exceção.
- LLM/UI NUNCA escrevem no banco. Sempre via Action (authorize→validate→tx→write-back→audit).
- Connector NUNCA importa nada da Ontology.
- Transformação é determinística: mesmo input → mesmo content_hash. Sem NOW() sem seed.

## Stack fixa (não trocar sem ADR)
TypeScript/Node 22 · pnpm+Turborepo · Postgres 16 · MinIO+Parquet · DuckDB · outbox+pg-boss · Fastify+Zod · better-auth · Next.js+shadcn · pino+OTel · Vitest+Testcontainers.

## NÃO construir agora (cortes explícitos)
Federation/pushdown, offline/replication, edge/SCADA, multi-tenant, microsserviços/Kafka/K8s, DSL própria, workflow engine genérico, agentes com write, ML de ER, mobile/geoespacial.

```

## ARQUIVO: `docs/adr/0001-contratos-congelam-por-release.md`

```markdown
# ADR-0001: Contratos congelam por release

**Contexto:** 14 contratos centrais são a espinha dorsal; IA gerando código pode alterá-los silenciosamente.
**Decisão:** Contratos vivem em `packages/contracts/v1/`. Mudança breaking exige ADR + bump para `v2/`. CI valida golden fixtures.
**Alternativa rejeitada:** versionar por pacote semver — granular demais para 1 dev.
**Consequência:** Qualquer mudança de interface é um evento explícito e revisado.

```

## ARQUIVO: `docs/adr/0002-parquet-minio-nao-iceberg.md`

```markdown
# ADR-0002: Parquet + MinIO em vez de Iceberg/Delta

**Contexto:** F2 exige store imutável com time travel.
**Decisão:** Versões de dataset = arquivos Parquet imutáveis no MinIO, content-hash sha256, manifests no Postgres.
**Alternativa rejeitada:** Iceberg/Delta — exigem JVM/catálogo, complexidade desproporcional agora.
**Consequência:** Upgrade para Iceberg fica aberto; nenhum contrato depende da implementação.

```

## ARQUIVO: `TAREFA_ATUAL.md`

```markdown
# COMECE AQUI — M0 (tasks 001–012)

Cole isto no chat do Cursor:

"Estamos construindo a plataforma descrita em docs/arch/visao-geral.md.
Respeite .cursor/rules/contracts.mdc e architecture.mdc.
Release atual: R1 / Marco M0 (Fundação mínima + IAM).
Critério de aceite do M0: build reproduzível, 1 ambiente via docker compose,
todo log com principal+trace_id, identidade (better-auth) funcionando, outbox Postgres operando.
Antes de gerar código, proponha o plano das tasks 001-012 e aguarde minha aprovação."

Depois execute task por task: "Execute a task 001" → revise → testes verdes → commit → próxima.

```

---

# BLUEPRINT TÉCNICA COMPLETA (referência)

# BLUEPRINT TÉCNICA DEFINITIVA — PLATAFORMA PALANTIR-LIKE
## Ordem corrigida · Patentes mapeadas · O que construir, testar, quando e com o quê · Método de implementação no Cursor

> **Como usar este documento**
> 1. A Parte 0 (esta) é a visão executiva: ordem corrigida, erros corrigidos, stack,
>    contratos e método de trabalho no Cursor. Leia inteira antes de codar.
> 2. As Partes A, B e C detalham os marcos M0–M9: patentes → problemas → invariantes,
>    componentes, modelos de dados, testes obrigatórios e tasks numeradas (001–180)
>    dimensionadas para sessões de Cursor.
> 3. Copie a seção "Método Cursor" para `.cursor/rules/` e `docs/arch/` no seu repo.
> 4. Execute as tasks na ordem numérica. Cada task termina com testes verdes + commit.

---

# PARTE 0 — FUNDAÇÃO DO PLANO

## 0.1 Veredicto da revisão (resumo executivo)

A blueprint original está **certa na arquitetura e errada no sequenciamento**. Ela
contém duas ordens contraditórias: as fases F0–F11 (sequenciais, completas) e os
milestones A–L + vertical slice (incrementais, demonstráveis). Os milestones estavam
certos. Esta blueprint definitiva **torna os marcos o plano oficial** e transforma as
fases em domínios de engenharia que amadurecem ao longo de vários marcos.

Três princípios governam tudo:

1. **Interfaces estáveis antes da camada superior** (da blueprint original) — os
   contratos congelam por release e vivem em `packages/contracts`.
2. **Nenhum engine é generalizado antes de ser usado pelo slice** — connector, store,
   policy e ontology nascem mínimos e endurecem quando um consumidor real exige.
3. **Patente → problema técnico → invariante → arquitetura independente → testes** —
   patentes são mapa de problemas, nunca código copiado.

## 0.2 Os erros corrigidos (E1–E7)

| # | Erro na ordem original | Correção |
|---|---|---|
| **E1** | F5 (Replication/Offline) na posição 5, mas seu protocolo replica **mutações de objetos (F7) e actions (F8)** que ainda não existem — seria reescrito | F5 move-se para **M7**, sobre objects/actions, depois de Search/Apps |
| **E2** | F4 (Security) tarde demais como segurança (T1.7, sandbox e `principal` já a exigem desde F0–F3) e cedo demais como lineage completo (inclui OBJECT e MODEL OUTPUT) | F4 dividida: **F4a** (identidade+policy mínimo+audit) na fundação; núcleo no M4/R4; **hardening** (lineage colunar, redaction, noninterference) no M5 |
| **E3** | F6 (Entity Resolution) antes de F7 (Ontology) é **circular**: o ER resolve contra entidades da ontology e usa "ontology neighborhood" que só existe na F7 | F6 + F7-lite construídas **juntas** no M3, convergindo |
| **E4** | **Identidade/IAM/SSO não existia em fase nenhuma**, embora `principal` seja obrigatório desde F0.4 e o authorization graph da F4 presuponha USER/GROUP/ROLE | Criada no **M0** como fundação |
| **E5** | "Canonical Event Bus" (F1) e "message broker" (F11) aparecem sem dono — nunca são construídos | Decisão de mensageria no **M0** (Postgres outbox + pg-boss) |
| **E6** | Acoplamento circular F2↔F4: version record com `policy_id`/`lineage_ref` antes de F4 existir | Colunas **reservadas** no schema desde a R1 |
| **E7** | Risco "ano sem valor": F0–F2 completas = 6–9 meses de infra sem demo | Gates **mínimos por release**; vertical slice completo na R5 |

## 0.3 A ordem correta — o que construir e POR QUÊ

```
1º  M0 Fundação+IAM ──────► 2º  M1 Ingest+Store ──────► 3º  M2 Transform+Policy
                                                                │
4º  M3 ER+Ontology ◄────────── 5º  M4 Loop operacional ◄────────┘
    (coração, 1º valor)          (fecha o ciclo)
        │
6º  M5 Security hardening ──► 7º  M6 Search/Apps+Federation ──► 8º  M7 Replication/Offline
                                                                    │
                                        9º  M8 AIP (4 degraus) ◄────┘
                                                │
                                        10º M9 Closed-loop E2E + hardening
```

| # | Marco | Construir | POR QUÊ nesta posição |
|---|---|---|---|
| 1º | **M0** Fundação mínima + IAM | Build, 1 ambiente, observability c/ `principal`, **identidade/secrets**, **event bus**, tenancy básica | Identidade é a única coisa que **não pode ser retrofitada** — tudo que as camadas seguintes emitem carrega principal/policy_tags desde o 1º evento. Escopo "chato e pequeno" (E7) |
| 2º | **M1** Ingestão + Store imutável | 1 connector, envelope canônico, schema registry, **dataset versioning + time travel** | 1ª propriedade demonstrável ("estado às 14:37:22"). Sem história reproduzível não há o que transformar/resolver/mapear. Federation/edge → M6 |
| 3º | **M2** Transformação + Security mínima | Transform SQL versionado, DAG, **scheduler incremental**, lineage por versão + `authorize()` + audit hash-chained | Gate incremental exige o versionamento; enforcement de policy existe **antes** de dados sensíveis fluírem (evita retrofit — E2) |
| 4º | **M3** ER + Ontology juntas | Ontology registry, mapping versionado, Object API + ER determinístico (blocking/scoring), gold set, canonical entities | Resolve a circularidade F6↔F7 (E3). **Coração do produto** — 1º valor de negócio visível: duplicatas convergem para 1 objeto com provenance |
| 5º | **M4** Loop operacional | Policy/Audit núcleo (R4) + Function + **Action real com write-back** + busca permission-aware (R5) | 1ª execução do ciclo observe→decide→act→write-back — **o produto** segundo a própria blueprint. Write-back volta pelo connector |
| 6º | **M5** Security hardening | Lineage colunar, propagação de classificação, redaction, noninterference, fuzzing | Só faz sentido endurecer propagação quando existem transforms/objetos/actions reais propagando dados |
| 7º | **M6** Escala de acesso | Query planner multi-backend, índice permission-aware completo, apps operacionais, federation/edge se houver fonte real | Search em escala só se prova com volume real; federation só se paga com fonte que não pode ser copiada |
| 8º | **M7** Distribuição | Replication cross-ACL, offline, conflict resolution — **sobre objects/actions** | Agora existe o que replicar (E1). Protocolo projetado 1× contra a abstração certa |
| 9º | **M8** AIP em 4 degraus | LLM read-only → agent→function → proposed action → authorized action | AIP é **consumidor** da plataforma. Cada degrau de autonomia exige o anterior provado |
| 10º | **M9** Closed-loop | Teste E2E de 17 passos, DR, chaos, load, replay | Validação sistêmica, não construção |

## 0.4 Releases e critérios de aceite

| Release | Marcos | Entrega | Aceite demonstrável |
|---|---|---|---|
| **R1** | M0+M1 | Fundação + ingestão imutável | `snapshot(timestamp)` responde deterministicamente "o estado do dataset X às 14h de ontem"; T1.1/T1.3 passam; todo log tem `principal`+`trace_id` |
| **R2** | M2 | Transformação + lineage + policy mínimo | Mudar 1 input → só descendentes recalculam; grafo input→output com hashes; `authorize()` no caminho de toda leitura |
| **R3** | M3 | ER v0 + Ontology v0 | "ACME LTDA" (A) + "Acme Ltda." (B) → 1 objeto `Customer` com provenance; precision/recall no gold set de 50 pares |
| **R4** | M4a | Policy + Audit + 2ª fonte | Sem permissão: não vê objeto **nem o count**; audit detecta adulteração (hash chain) |
| **R5** | M4b | **Vertical slice completo** | `ReclassifyCustomer` → write-back muda a fonte → connector detecta → nova versão → ontology atualiza → audit mostra o ciclo de 17 passos |
| **R6** | M6 | Search + App operacional | 2 views diferentes, 0 lógica duplicada; busca não vaza objeto proibido |
| **R7** | M8 (degraus 1–2) | AIP read-only | Pergunta NL respondida grounded citando objetos; **trocar o LLM e nada quebra** |
| **R8** | M8 (degraus 3–4) | Agente propose→approve→execute | Agente propõe Action → humano aprova → executa pelo Action engine da R5; eval suite passa em prompt injection |
| pós | M5/M7/M9 | Hardening tracks | Conforme gatilhos: dados sensíveis reais, cenário desconectado real, pré-produção |

## 0.5 Stack técnica fixa

| Item | Escolha | Por quê | Upgrade futuro |
|---|---|---|---|
| Linguagem | **TypeScript (Node 22)** end-to-end | Uma linguagem maximiza produtividade da IA e elimina dessincronia de tipos | — |
| Monorepo | **pnpm workspaces + Turborepo** | IA refatora atravessando camadas com segurança | — |
| Arquitetura | **Modular monolith** | Microsserviços cedo = custo sem benefício; módulos viram serviços se precisar | Extração por módulo |
| Relacional + Grafo | **Postgres 16** (+ recursive CTE p/ links; pgvector futuro) | Um banco cobre metadados, filas, objetos e grafo até escala alta | Neo4j |
| Immutable store | **MinIO (S3) + Parquet** | Versões como arquivos imutáveis com content-hash = 90% da F2 sem JVM | Iceberg/Delta |
| Transform/Compute | **DuckDB embedded (SQL)** | Lê Parquet/Postgres nativo, determinístico, dispensa Spark/Airflow | Spark (>100M eventos/dia) |
| Mensageria | **Postgres outbox + LISTEN/NOTIFY + pg-boss** | Exactly-once lógico com zero infra nova (resolve E5) | Kafka/Redpanda |
| API | **Fastify + Zod** | Zod = validação + tipos + OpenAPI do contrato | — |
| Auth | **better-auth** atrás de `IdentityProvider` interno | Autorização passa pelo Policy API, nunca pelo middleware (resolve E4) | Keycloak/OIDC |
| Pipelines | **Scheduler próprio** (topological sort + pg-boss) | "Dynamic Pipeline Processing" = ~200 linhas sobre o grafo de deps | Temporal |
| Frontend | **Next.js + shadcn/ui + TanStack Query** | Ecossistema que o Cursor gera melhor | — |
| Busca | **Meilisearch** (a partir de R6) | Binário único; ACL no documento + filtros = índice permission-aware | Elasticsearch |
| Observabilidade | **pino + OpenTelemetry → Jaeger + Prometheus/Grafana** | Cobre T0.5 (trace_id, actor, latência) em 1 dia | Stack gerenciada |
| Testes | **Vitest + Testcontainers + Playwright** | Testcontainers com Postgres/MinIO reais torna os invariantes honestos | — |
| Local dev | **docker compose** apenas | Terraform/K8s só com 2º ambiente real | K8s + Terraform |

## 0.6 Contratos centrais (a espinha dorsal)

Congelam por release em `packages/contracts/v1/` (mudança breaking = ADR + bump para
`v2/`; CI com golden fixtures impede alteração silenciosa pela IA):

| Contrato | Congela em | Conteúdo essencial |
|---|---|---|
| **Connector API** | R1 | `discover/schema/snapshot/read(cursor)/checkpoint/health` — connector NUNCA importa Ontology |
| **CanonicalEvent** | R1 | Envelope: event_id, source_system, source_object, source_primary_key, schema_version, occurred_at, ingested_at, connector_id, checkpoint, **principal**, **policy_tags**, payload_hash, payload |
| **Dataset API** | R1 | `createDataset/commitVersion/getLatestVersion/getVersion/diff/snapshot(at)/listVersions`; CommitInput já inclui `policyId` e `lineageRef` **reservados** (resolve E6) |
| **Transformation API** | R2 | `register/run/dependentsOf`; PipelineRun: inputVersions[]→outputVersion; determinismo = contrato |
| **Lineage API** | R2 | `upstream/downstream(version)`; 100% dos outputs apontam inputs |
| **Policy API** | R2 (tipo) / R4 (enforcement) | `authorize(principal, resource, operation, context) → allow \| deny \| partial` |
| **Ontology API** | R3 | Registry (ObjectType/LinkType/Mapping versionados) + ObjectService (`getObject(at?)/queryObjects/traverseLinks/getHistory/getProvenance`) |
| **ER API** | R3 | candidate/score/decide/review; persiste score+features+rule_version+reason |
| **Function API** | R5 | `f(objects) → result` — nunca altera estado |
| **Action API** | R5 | ActionRequest com `expectedObjectVersions` + `idempotencyKey` + `reason`; pipeline FIXO: authorize→validate→tx→write-back→audit |
| **Search API** | R6 | Query API → Ontology Query Planner → Object Store/Index/Graph/Federation |
| **Agent Tool API** | R7 | tool_id, input_schema, output_schema, required_permission, risk_level, timeout, rate_limit |
| **Evaluation API** | R7 | eval_case versionado: input, context, allowed_tools, expected, forbidden, rubric, result |
| **Deployment API** | M9 | Só quando houver 2º ambiente real |

## 0.7 Método de implementação no Cursor

**Estrutura do monorepo:**

```
platform/
├── packages/
│   ├── contracts/        # v1/, v2/ — zod schemas + tipos. INTANGÍVEL sem ADR
│   ├── core/             # DatasetStore, TransformRunner, PolicyEngine, ActionEngine
│   └── testing/          # golden fixtures, factories, helpers de Testcontainers
├── modules/              # ingest, transform, ontology, policy, search, aip
│                         # cada um: index.ts público + internals/
├── connectors/           # postgres, csv, rest — dependem SÓ de contracts
├── apps/
│   ├── api/              # Fastify: monta os módulos como rotas
│   ├── worker/           # pg-boss consumers
│   └── web/              # Next.js
├── docs/
│   ├── adr/              # 0001-contratos-congelam.md, ...
│   └── arch/             # 1 página por módulo: propósito, contratos, invariantes
├── migrations/           # SQL numerado, SEMPRE revisado linha a linha
└── .cursor/rules/        # contracts.mdc, architecture.mdc, um por domínio
```

**Regras de ouro com a IA:**

1. **Contratos são intangíveis.** `.cursor/rules/contracts.mdc`: "Se uma task parecer
   exigir mudança de contrato, PARE e proponha um ADR em vez de editar." Golden
   fixtures no CI quebram o build se o shape mudar.
2. **1 prompt = 1 função/classe + seus testes.** As tasks 001–180 já estão nesse
   tamanho. 1 sessão = 1 invariante fechada, terminando com `pnpm test` verde + commit.
   Nunca termine com teste vermelho.
3. **Migrations SQL sempre revisadas linha a linha** — único lugar onde um erro da IA
   destrói dados de verdade.
4. **Prompts citam o contrato:** "implemente `DatasetStore.commitVersion` conforme
   `packages/contracts/v1/dataset.ts`, sem alterar a interface".
5. **ADRs curtos** (Contexto / Decisão / Alternativa rejeitada / Consequência) — a IA
   os usa como contexto de "por quê".
6. **Ao abrir cada release:** cole objetivo + critério de aceite no chat e peça o plano
   de tasks antes de gerar código; compare com este documento.

## 0.8 O que NÃO construir nos primeiros 6 meses

| Corte | Justificativa |
|---|---|
| Federation em tempo real (pushdown) | Só com fonte que realmente não pode ser copiada (→ M6) |
| Offline/conflict resolution/multi-replica | Parte mais difícil da blueprint; sem caso de uso real no ano 1 (→ M7) |
| Edge/SCADA/IoT | Vertical específica; Connector API já acomoda depois (→ M6) |
| Multi-tenant | Dobra a superfície de segurança; mantenha só a coluna `tenant_id` |
| Microsserviços, Kafka, Kubernetes | Custo sem benefício na escala de 1 dev |
| DSL própria de transformação | SQL versionado + DuckDB = 95% do valor |
| Workflow engine genérico com saga | Action de 1 passo com idempotência primeiro; multi-step com o 2º caso real |
| Agentes autônomos com write | M8 degraus 3–4 (propose+approve) é o máximo responsável |
| ML de entity resolution | Regras + gold set bastam com chaves fortes (CNPJ/email); ML sem gold set grande = false-merge factory |
| Mobile, geoespacial, UI elaborada | Não fecham loop; F9 prova-se com 1 app web |
| Noninterference total (side-channels) | R4 cobre o essencial; threat model completo = M5 com pentest |

---

# PARTE A — MARCOS M0–M2: FUNDAÇÃO, INGESTÃO+STORE, TRANSFORMAÇÃO+SECURITY

### M0 — FUNDAÇÃO MÍNIMA + IAM (cobre F0 reduzida + gap de identidade/secrets/event bus da blueprint original · Release R1)

**Por que nesta posição:** a F0 completa da blueprint (build graph, deployment control plane multi-ambiente, canary, rollback) é meses de infraestrutura que não prova valor nenhum para um dev solo — o que é irredutível dela é: build reproduzível, um ambiente, observabilidade e a separação código/config/secrets. Ao mesmo tempo, três coisas que a blueprint **nunca constrói** são pré-condição de tudo que vem depois: identidade (`principal` é exigido no item 0.4 e no T0.5 da própria F0, mas nenhum componente o produz), secrets e o event bus ("Canonical Event Bus" aparece na F1 sem dono). Identidade é a única peça que não pode ser retrofitada: se entrar depois do M1/M2, todo caminho de read/write é reescrito e todos os testes de segurança são refeitos.

**Erros corrigidos aqui:** E4 (IAM/SSO não existia em fase nenhuma → nasce no M0), E5 (event bus sem dono → decisão de mensageria: Postgres outbox + LISTEN/NOTIFY + pg-boss), E7 (gates mínimos por release em vez de fases completas — M0 é deliberadamente "chato e pequeno").

#### Patentes → problema técnico → invariante

Família **Núcleo** (F0):

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,001,982 | Núcleo — Common Build System | mesmo commit + mesmas deps → mesmo artefato em qualquer máquina | build é função pura do lockfile: hash do artefato idêntico em 2 builds (TM0.1) |
| US 10,509,647 | Núcleo — Dynamic Documentation | docs da plataforma dessincronizam do código real | `docs/arch/*.md` e contratos zod são a fonte; CI falha se contrato mudar sem ADR (TM0.6) |
| US 11,681,606 | Núcleo — Automatic Configuration of Logging | configuração de logging deriva entre serviços | logging/tracing é middleware único do apps/api e apps/worker; nenhum módulo configura o seu (TM0.2/TM0.5) |
| US 11,870,666 | Núcleo — Software Usage Metrics | saber quem usa o quê sem SDK de telemetria externo | todo request emite métrica com `service`, `operation`, `principal`, `result`, `duration` (TM0.5) |

Família **Hardening moderno** (F0):

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| EP4660856A2/A3 | Hardening — Managing Software Security | segredos e config de segurança embutidos em artefato | nenhum secret no artefato nem no log; config separada em 5 planos (TM0.4) |
| US20250298632A1 | Hardening — configuração de ambientes | drift entre "o que está rodando" e "o que deveria estar" | ambiente é um único `docker-compose.yml` versionado; estado do ambiente é reconstruível do repo (gate M0) |

Design patents não entram (trilha clean-room de UX, fora do backend).

#### O que construir

**1. Monorepo e build reproduzível (US 10,001,982).** pnpm workspaces + Turborepo com `tsconfig.base.json` único, eslint com `no-restricted-imports` (módulos só importam `packages/contracts`, nunca internals alheios). CI: lint → typecheck → test → build → hash sha256 do artefato, buildado 2× e comparado (T0.1). Cada app (`api`, `worker`) carrega um `service.json` com `service_id`, `name`, `version`, `artifact_hash`, `dependencies[]`, `api_version`, `health_endpoint`, `metrics_endpoint`, `owner` — Service Registry mínimo da F0.1. Deployment Control Plane, canary, rollback multi-ambiente e Build Graph assinado: **não construir** — hardening, M9.

**2. Identidade (E4 — o gap central).** `IdentityProvider` interno (`resolvePrincipal(token) → Principal`) implementado com better-auth atrás dele. Modelo: `principals` (user ou service account), `groups`, `group_members`, todos com `tenant_id` desde o dia 1 (single-tenant operacional; o campo alimenta o `context.tenant` do PolicyEngine no M2). Service accounts são principals de primeira classe — o connector do M1 e o scheduler do M2 rodam sob elas, não sob credencial mágica. Middleware Fastify resolve o principal em **todo** request e injeta em `request.principal` e no child logger; sem principal → 401. Upgrade nomeado: Keycloak/OIDC, trocando só a implementação do provider.

**3. Secrets e configuração (F0.5, EP4660856A2/A3).** Separação obrigatória em CODE / CONFIGURATION / SECRETS / POLICY / ENVIRONMENT STATE. Implementação: SOPS + age (arquivos `secrets.enc.yaml` versionados no repo, chave age fora do repo); config loader único em `packages/core/config` que falha o boot se variável obrigatória faltar. Nenhum secret em `.env` commitado, em imagem ou em log — o logger tem redactor de campos (`password`, `token`, `authorization`, chaves `*_KEY`). Upgrade nomeado: Vault/Doppler quando houver 2º ambiente.

**4. Event bus (E5).** Postgres outbox transacional: escritores gravam dados + registro em `outbox_events` na **mesma transação**; publisher faz LISTEN/NOTIFY e entrega a consumers; pg-boss para jobs com retry/backoff. Semântica declarada: at-least-once, ordering por chave (`source_system + source_primary_key`), consumers idempotentes por `event_id` — o que torna os testes de crash (F2) e o CDC (F1) honestos sem Kafka. Upgrade nomeado: Kafka/Redpanda se >100M eventos/dia.

**5. Observabilidade (F0.4).** pino + OpenTelemetry em um único middleware/instrumentador compartilhado. Todo log/span emitido carrega: `trace_id`, `service`, `version`, `deployment_id`, `correlation_id`, `principal`, `operation`, `duration_ms`, `result`, `tenant_id`. Export para Jaeger + Prometheus/Grafana no compose. Isto implementa o T0.5 **com o acréscimo do E4**: `principal` não é opcional em nenhuma linha de log, inclusive do worker.

#### Com o quê (stack)

pnpm workspaces + Turborepo (monorepo) · TypeScript Node 22 · Fastify + Zod (API e validação de envelope) · better-auth atrás de `IdentityProvider` interno (troca por OIDC sem dor) · SOPS + age (secrets; justificativa: zero infra nova, criptografia versionada no repo) · Postgres 16 (outbox, principals, jobs) · pg-boss + LISTEN/NOTIFY (mensageria) · pino + OpenTelemetry → Jaeger + Prometheus/Grafana (compose) · Vitest + Testcontainers (testes de invariante com Postgres real) · docker compose apenas.

#### Contratos congelados neste marco

Congelam em `packages/contracts/v1`: **CanonicalEvent** (envelope com `event_id`, `source_system`, `source_object`, `source_primary_key`, `schema_version`, `occurred_at`, `ingested_at`, `connector_id`, `checkpoint`, `principal`, `policy_tags[]`, `payload_hash`, `payload`) — congela aqui e não no M1 porque o outbox já o persiste; **Principal/IdentityProvider** (`Principal { id, kind: user|service, groups[], tenant_id }`); **tipos-base do outbox** (`OutboxRecord`, `EventHandler`). Definidos já mas congelam depois: `PolicyEngine.authorize()` (o tipo `Decision = allow | deny | partial` é definido no M0 como stub default-allow com TODO marcado; congela no M2), Connector e DatasetStore (congelam no M1).

#### Testes obrigatórios

Preservados da F0 (renumerados):
- **TM0.1** (orig. T0.1 — Reproducible build): mesmo commit + lockfile → mesmo sha256 do artefato, em CI.
- **TM0.5** (orig. T0.5 — Observability): harness varre 100% das requisições críticas e exige `trace_id`, `actor/principal`, `service`, `operation`, `result`, `latency`.
- **T0.2 (canary), T0.3 (rollback), T0.4 (node offline)** — preservados mas **adiados ao M9** (exigem 2 ambientes e spokes; sem sentido com 1 compose). Registrados como dívida explícita no gate.

Novos (erros corrigidos):
- **TM0.2** (E4): todo log de api **e worker** contém `principal` e `tenant_id` — falha se qualquer linha JSON do pino não os tiver.
- **TM0.3** (E5): writer commita dado + outbox numa tx; publisher entrega pelo menos uma vez; consumer duplicado é absorvido por idempotência de `event_id`.
- **TM0.4** (E4/EP4660856): nenhum secret aparece em artefato de build, log ou resposta de erro (grep automatizado + redactor do pino).
- **TM0.6** (contratos): golden fixture do `CanonicalEvent` no CI — qualquer mudança de shape sem ADR quebra o build.

**Gate de saída M0:** subir o compose do zero, autenticar, chamar uma API protegida e ver no Jaeger o trace completo com `principal` em todos os spans; um evento publicado via outbox é consumido pelo worker com log encadeado pelo mesmo `trace_id`. Build reproduzível verde no CI.

#### Tasks para o Cursor (001–012)

1. `001` Scaffold monorepo: pnpm workspaces, Turborepo, `tsconfig.base.json`, eslint (+`no-restricted-imports`), vitest, `.cursor/rules/contracts.mdc` e `architecture.mdc`.
2. `002` `docker-compose.yml` (postgres:16, minio, jaeger, prometheus, grafana) + script `dev:up` + healthchecks.
3. `003` `packages/contracts/v1`: `CanonicalEvent` (zod, campos exatos) + golden fixture + teste round-trip.
4. `004` `packages/contracts/v1`: tipos `Principal`, `IdentityProvider`, `OutboxRecord`, stub `Decision` (allow/deny/partial) com TODO "congela M2".
5. `005` Migration SQL 0001: `principals`, `groups`, `group_members`, `service_accounts`, `outbox_events` — todas com `tenant_id`; revisada linha a linha.
6. `006` `IdentityProvider` com better-auth: login/sessão, emissão de token de service account, seeds de principals de dev.
7. `007` Middleware Fastify de identidade: resolve principal, 401 sem ele, injeta `request.principal` + child logger; teste TM0.2 (principal em todo log).
8. `008` Config loader (`packages/core/config`) separando CODE/CONFIG/SECRETS/POLICY/ENV + SOPS/age + redactor de secrets no pino; teste TM0.4.
9. `009` Outbox transacional: helper `withOutbox(tx, records)`, publisher LISTEN/NOTIFY, consumer base idempotente; teste TM0.3.
10. `010` pg-boss: setup, filas, retry/backoff, consumer skeleton no `apps/worker`.
11. `011` Observabilidade: instrumentação OTel + pino compartilhada, exporters Jaeger/Prometheus, `service.json` por app; harness TM0.5.
12. `012` CI com build 2× e comparação de hash (TM0.1) + teste de contrato no CI (TM0.6) + ADR-0001 (contratos congelam) + ADR-0002 (outbox Postgres, não Kafka) + `docs/arch/fundacao.md`. Gate M0 verde.

### M1 — INGESTÃO + STORE IMUTÁVEL (cobre F1 essencial — sem federation/edge — + F2 completa da blueprint original · Release R1)

**Por que nesta posição:** é a primeira propriedade demonstrável da plataforma — "dado entra, história é reproduzível". Sem store imutável não há o que transformar (M2), resolver (M3) ou mapear. F1 entra reduzida ao essencial do slice (snapshot + CDC + checkpoint + schema registry + drift); federation/pushdown e edge/SCADA são projetos inteiros que só se pagam com uma fonte real que os exija — o Connector API apenas os acomoda (→ M6). F2 entra **completa**: imutabilidade, versionamento, delta tree e time travel são indivisíveis — "versionamento sem delta tree" significaria refazer o storage no M2.

**Erros corrigidos aqui:** E6 (acoplamento F2↔F4 → `policy_id` e `lineage_ref` entram como **colunas reservadas** no version record desde o schema da R1 — num store imutável, adicionar campo retroativo a manifests é o erro mais caro possível), E4 (T1.7, que na ordem literal era inexequível — "usuário sem acesso à fonte não pode obter o dado" exigia IAM que não existia — agora é executável porque o M0 existe), E5 (CDC e crash-recovery rodam sobre o outbox do M0).

#### Patentes → problema técnico → invariante

Família **Data integration** (F1):

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,930,897 | Data integration — fonte externa → modelo canônico | conectar sem substituir o sistema fonte; envelope único para todo dado | todo dado entra como `CanonicalEvent` validado por zod; connector nunca importa Ontology (TM1.1, TM1.8) |
| US 9,984,152 | Data integration (continuation) | ingestão resumível após falha | checkpoint persistente; parar no evento 10.000 e continuar certo (TM1.3) |
| US 10,572,529 | Data integration (continuation) | mudanças incrementais sem re-snapshot | insert/update/delete aparecem exatamente uma vez no estado final (TM1.2) |
| US 11,100,154 | Data integration (continuation) | schema da fonte muda sem quebrar o pipeline | drift classificado compatible/coercible/breaking/unknown com resposta definida (TM1.4) |

Família **Federation** (F1) — **implementar em M6**, apenas acomodar no contrato:

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,402,397 | Federation — pushdown | responder sem copiar 5 TB | → M6: Connector API declara `capabilities[]` (ex.: `pushdown`, `subscribe`) para não exigir mudança de contrato depois; nenhum planner agora |
| US 11,281,659 | Federation — representações temporárias | acesso antes de materializar | → M6: `read(cursor)` já devolve stream (AsyncIterable), não arquivo — a mesma forma serve à materialização temporária |
| US 11,681,690 | Federation (continuation) | consulta federada com permissão | → M6: T1.5 (consultar remoto sem copiar) fica registrado como teste pendente; `policy_tags` no envelope já preserva classificação da fonte |

Família **Importação/modelagem** (F1):

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,330,120 | Visual Data Importer | importação por não-engenheiro | → M6 (UI): em M1 o schema registry + drift classifier são o backend que essa UI consultará; mapeamento declarativo JSON já existe no ingest worker |
| US 10,809,888 / US20140282121 | Tagging de conteúdo externo | metadados/classificação na entrada | `policy_tags[]` e `semantic_hint` (schema registry) capturados na ingestão, não retroativamente (TM1.7) |
| US 10,552,524 | Inline tagging + object synchronization | sincronizar marcações com objetos | → M3/M6: o envelope carrega `source_primary_key` estável, pré-condição da sincronização objeto↔fonte |

Família **Edge / mundo físico** (F1) — **implementar em M6**, apenas acomodar no contrato:

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 11,799,877 | Edge — SCADA | fontes industriais com conectividade ruim | → M6: checkpoint/cursor opaco e resumível + outbox local já são a semântica que um agente de borda precisa |
| US 12,261,861 | Edge (continuação) | operação desconectada | → M6: consumers idempotentes por `event_id` absorvem reenvio de borda |
| US20250233873A1 | Edge (continuação) | pipelines de sensores | → M6: `source_system`/`connector_id` no envelope já distinguem origem sem mudança de schema |

Família **Versionamento/imutabilidade** (F2):

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,229,952 | History Preserving Data Pipeline | histórico completo, nunca sobrescrever | versão commitada é imutável; "alteração" = nova versão com `parent_version` (TM1.5) |
| US 9,483,506 | History preserving (continuation) | responder estado em qualquer ponto do tempo | `snapshot(at)` determinístico — o gate da F2 (TM1.6) |
| US 9,946,738 | Versioned/universal pipeline | versões como cidadãs de 1ª classe p/ pipelines | `DatasetVersion` com `input_versions[]`, `transformation_id`, `schema_version`, `content_hash`, `policy_id`, `lineage_ref` (E6) |
| US 11,397,717 | Data Storage Deltas | reconstrução eficiente sem replay linear de Δ1..ΔN | delta tree: deltas individuais + combined deltas Δ1–10, Δ11–20…; reconstrução byte-for-byte (TM1.9, TM1.10) |
| US 8,504,542 | Multi-row transactions | commit atômico de muitas linhas | versão commita tudo-ou-nada; crash entre write e commit não deixa versão visível (TM1.11) |
| US 9,619,507 | Transaction read protocol | leitura consistente durante escrita | leitores veem sempre a última versão **commitada**; leitura durante commit não bloqueia nem vê parcial (TM1.12) |
| US 9,367,463 / US 9,652,291 | Zero-copy/caching | não copiar dados entre versões | arquivos Parquet content-addressed (sha256) no MinIO; versões referenciam blobs — dedup natural por hash |
| US 9,092,482 / US 9,715,526 | Fair scheduling | ingest concorrente sem starvation | filas pg-boss por connector com concorrência limitada; backpressure sem perda (TM1.13) |

#### O que construir

**1. Connector SDK e runtime (F1, sem federation/edge).** Contrato `Connector`: `discover()`, `schema(obj)`, `snapshot(obj)`, `read(cursor)`, `checkpoint()`, `health()` — com `capabilities[]: ("snapshot"|"cdc"| "pushdown"|"subscribe")[]` declaradas (pushdown/subscribe só serão implementadas no M6). Regra de ouro: connector depende **somente** de `packages/contracts` — nunca da Ontology. Primeiro connector: **Postgres genérico** — `snapshot()` via scan paginado; `read(cursor)` por polling em coluna `updated_at` + tabela de tombstones para deletes (CDC lógico; WAL/logical decoding é upgrade nomeado se o polling não bastar). Cursor opaco, persistido em `connector_checkpoints`. Todo connector roda sob **service account** com grant explícito na fonte (T1.7). Segundo connector (CSV) entra só se sobrar sessão — o gate exige que ele **não toque o core**.

**2. Canonical Event Bus (F1 + E5).** Todo evento recebe o envelope `CanonicalEvent` do M0, com `payload_hash` sha256 do payload canonicamente serializado, publicado via outbox na mesma transação do raw write, com ordering por `source_system + source_primary_key`.

**3. Schema registry + drift (F1).** Tabela `schema_registry`: `source`, `object`, `column`, `physical_type`, `semantic_hint`, `nullable`, `is_primary_key`, `foreign_keys[]`, `observed_values_sample`, `first_seen`, `last_seen`, `schema_version`. O classificador compara o schema observado com o registrado: `compatible` (aditivo nullable) → novo `schema_version` automático; `coercible` (widening INT→DECIMAL) → novo schema_version + cast registrado; `breaking` (remoção/narrowing) / `unknown` → connector pausa a fonte e abre alerta — nunca quebra silenciosamente nem engole a mudança.

**4. Immutable store + versioning (F2 completa).** Modelo `Dataset 1..N DatasetVersion`; **nunca** `dataset_current.csv` sozinho. `dataset_versions`: `dataset_id`, `version_id`, `parent_version`, `created_at`, `created_by` (principal), `input_versions[]`, `transformation_id`, `schema_version`, `content_ref`, `content_hash`, **`policy_id` (nullable, reservado — E6)**, **`lineage_ref` (nullable, reservado — E6)**, `delta_ref`, `delta_kind` (`full|delta|combined`). Imutabilidade por trigger no Postgres (UPDATE/DELETE em versão commitada = erro) e objeto imutável no MinIO. Commit: Parquet content-addressed (sha256 no path → dedup/zero-copy), valida hash, commita manifest + outbox numa tx.

**5. Delta tree (US 11,397,717).** Cada versão grava seu delta individual contra o parent; a cada 10, um job grava `combined Δ1–10` como blob separado (nunca reescreve os individuais). Reconstrução: base + maior combined ≤ alvo + deltas restantes. Todo delta tem checksum; delta corrompido é detectado no read e a reconstrução o contorna.

**6. APIs (F2, conforme contrato).** `createDataset()`, `commitVersion()`, `getLatestVersion()`, `getVersion(id)`, `diff(v1,v2)` (via DuckDB sobre os dois Parquets), `snapshot(at)`, `listVersions()`, `replay()` (reconstrói do zero a partir de eventos/deltas). CLI `pnpm ds snapshot <dataset> --at <ts>` — é a "UI" do critério de aceite da R1.

#### Com o quê (stack)

MinIO + Parquet (store imutável content-addressed; justificativa: 90% da F2 sem JVM — upgrade nomeado Iceberg/Delta) · DuckDB embedded (diff/reconstrução sobre Parquet) · Postgres 16 (manifests, schema registry, checkpoints, outbox) · pg-boss (ingest jobs, compactação) · Fastify + Zod (Dataset API) · Vitest + Testcontainers (Postgres/MinIO reais — T1.x honestos) · `connectors/postgres` dependendo só de contracts.

#### Contratos congelados neste marco

Congelam em `v1`: **Connector API** (com `capabilities[]` e `Cursor` opaco — acomoda federation/edge do M6 sem breaking change) e **DatasetStore** (`CommitInput` inclui `policyId` e `lineageRef` como campos **reservados** — congelados no shape desde já, preenchidos no M2). Definido, congela no M2: `TransformationEngine`.

#### Testes obrigatórios

Preservados da F1 (renumerados; T1.5 vai ao M6):
- **TM1.1** (orig. T1.1 — Snapshot idempotente): mesmo snapshot 2× → resultado lógico idêntico (mesmo conjunto de chaves, mesmo conteúdo; versões distintas, mesmo `content_hash`).
- **TM1.2** (orig. T1.2 — CDC): insert, update e delete aparecem exatamente uma vez no estado final.
- **TM1.3** (orig. T1.3 — Restart): parar o connector no evento 10.000, reiniciar, continuar do checkpoint correto sem duplicar nem pular.
- **TM1.4** (orig. T1.4 — Schema drift): adicionar, remover e alterar coluna → classificação compatible/breaking/coercible correta e resposta definida.
- **TM1.7** (orig. T1.7 — Security; **agora executável — E4**): service account sem grant na fonte não registra nem executa connector; dado ingerido herda `policy_tags`/`principal` — usuário sem acesso à fonte não obtém o dado só porque ele passou pelo connector. Reforçado no caminho de leitura pela security matrix do M2 (TM2.12).
- **TM1.13** (orig. T1.6 — Backpressure): fonte produz 10× a capacidade → fila cresce, nenhum evento é perdido, ordem por chave preservada.
- **T1.5 (Federation)** — preservado, **adiado ao M6** com o pushdown planner.

Preservados da F2 (os 9 testes sem número da blueprint, agora numerados):
- **TM1.5** (imutabilidade/reconstrução byte-for-byte): qualquer versão reconstruída bit a bit a partir de base+deltas.
- **TM1.6** (time travel): `snapshot(at)` determinístico — o gate da F2.
- **TM1.8** (duplicate commit): mesmo conteúdo → mesmo `content_hash`, commit duplicado não cria versão nova espúria.
- **TM1.9** (delta corrompido): checksum detecta; reconstrução contorna o delta inválido e alerta.
- **TM1.10** (compactação): após combined Δ1–10, reconstrução usa o combined e produz resultado idêntico ao caminho sem compactação.
- **TM1.11** (crash entre write e commit): kill -9 no meio do commit → nenhuma versão parcial visível; outbox reentrega e o retry conclui exatamente uma vez.
- **TM1.12** (concorrência / leitura durante commit): 2 writers → serialização por dataset, nenhum parent perdido; leitores nunca veem parcial.
- **TM1.14** (replay completo): `replay()` reconstrói o estado atual a partir dos eventos/deltas e o hash bate com a última versão.

Novos (erros corrigidos):
- **TM1.15** (E6): todo `dataset_version` criado — por ingest ou por transform — persiste as colunas `policy_id` e `lineage_ref` (nullable), e o contrato rejeita CommitInput com esses campos ausentes do schema (shape congelado).
- **TM1.16** (E4/E5): todo evento ingerido carrega `principal` (service account do connector) e `policy_tags`; o log do ingest tem `trace_id` encadeado com o request que o originou.

**Gate de saída M1 (= aceite R1, gate F2 original):** "Qual era exatamente o estado desse dataset às 14:37:22 de determinada data?" respondida deterministicamente via `snapshot(at)` + CLI, com `diff` entre versões. **+ gate F1 original:** conectar uma fonte completamente nova via SDK sem alterar o core (o 2º connector prova). T1.1–T1.4, T1.6, T1.7 e os 9 testes de F2 verdes.

#### Tasks para o Cursor (013–035)

1. `013` Contrato **Connector API** v1 (zod/TS): `discover/schema/snapshot/read/checkpoint/health`, `Cursor` opaco, `capabilities[]`; golden fixtures + teste de contrato; ADR-0003 "connector nunca importa Ontology".
2. `014` Contrato **DatasetStore** v1: todas as APIs + `CommitInput` com `policyId`/`lineageRef` reservados; golden fixtures.
3. `015` Migration SQL 0002: `datasets`, `dataset_versions` (com `policy_id`, `lineage_ref` nullable, trigger anti-UPDATE/DELETE), `schema_registry`, `connector_checkpoints` — revisada linha a linha.
4. `016` `packages/core/storage`: cliente MinIO + escrita Parquet content-addressed (sha256 no path) + verificação de hash no read.
5. `017` `DatasetStore.commitVersion()`: blob → manifest → tx com outbox; rejeita mutação (TM1.5 base).
6. `018` `getLatestVersion/getVersion/listVersions` + testes.
7. `019` `diff(v1,v2)` via DuckDB sobre Parquet + teste de diff correto.
8. `020` `snapshot(at)` time travel + teste TM1.6 (gate F2) + CLI `ds snapshot --at`.
9. `021` Testes de commit: duplicate commit (TM1.8) e crash entre write e commit (TM1.11, kill no Testcontainer).
10. `022` `connectors/postgres`: `snapshot()` paginado emitindo `CanonicalEvent` com `payload_hash`; teste TM1.1 (idempotente).
11. `023` `connectors/postgres`: `read(cursor)` — polling `updated_at` + tombstones de delete; teste TM1.2 (CDC exactly-once lógico).
12. `024` Checkpoint persistente em `connector_checkpoints` + teste TM1.3 (parar no evento 10.000, reiniciar).
13. `025` Grants de fonte: service account + tabela `source_grants`; connector só roda com grant; teste TM1.7 (parte connector).
14. `026` Ingest worker (pg-boss): envelope → valida zod → raw → `commitVersion` → atualiza `schema_registry`; log encadeado (TM1.16).
15. `027` Schema registry: upsert de colunas/tipos/first_seen/last_seen + API de consulta.
16. `028` Classificador de drift (compatible/coercible/breaking/unknown) + pausa de fonte em breaking + teste TM1.4.
17. `029` Backpressure: limites de concorrência pg-boss por connector + teste TM1.13 (fonte 10×, zero perda).
18. `030` Delta store: grava delta individual por versão (contra parent) + checksum por delta.
19. `031` Reconstrução base+deltas byte-for-byte + teste TM1.5 completo + TM1.9 (delta corrompido detectado e contornado).
20. `032` Job de compactação: combined Δ1–10 (append-only) + teste TM1.10 (resultado idêntico com/sem combined).
21. `033` Concorrência: lock por dataset no commit, leitores veem só commitado; teste TM1.12.
22. `034` `replay()` do zero a partir de eventos/deltas + teste TM1.14 (hash bate com última versão) + verificação TM1.15 (colunas reservadas presentes em todas as versões).
23. `035` Segundo connector (CSV) provando o gate F1 sem tocar o core + ADR-0004 "Parquet+MinIO, não Iceberg" + `docs/arch/ingest.md` + `docs/arch/store.md`. Gate M1/R1 verde.

### M2 — TRANSFORMAÇÃO + SECURITY MÍNIMA (cobre F3 completa + F4a — policy engine, audit, security matrix — da blueprint original · Release R2)

**Por que nesta posição:** o gate da F3 (incremental recompute) só é testável sobre o versionamento do M1 — mudar 1 input e provar que só descendentes recalculam exige `input_versions[]` pinados e `snapshot(at)`. E o enforcement de policy passa a existir **antes** de dados sensíveis fluírem por transforms: na ordem literal, F1–F3 eram construídas sem segurança real e o retrofit reescreveria o caminho de todo read/write ("security theater"). F4 entra só como **F4a** — `authorize()`, audit hash-chained, security matrix — porque lineage colunar, redaction e noninterference completa só se endurecem sobre transforms e objetos reais (→ M5).

**Erros corrigidos aqui:** E2 (F4 dividida: F4a sobe para M2; núcleo de propagação endurece no M4/R4 e hardening no M5), E6 (agora os campos reservados `policy_id`/`lineage_ref` do M1 passam a ser **preenchidos** — o acoplamento foi pago na R1 e custa zero aqui), E7 (R2 fecha com gate demonstrável: "altero 1 linha na fonte → só descendentes recalculam").

#### Patentes → problema técnico → invariante

Famílias da **F3 — Transformação/Compute**:

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,576,015 / US 9,965,534 | DSL para transformações | transformação como artefato versionado, não script solto | transform = SQL versionado em `transformations` (name+version+sql+inputs+output); parser/AST de DSL própria **adiado** — SQL+DuckDB cobre o caso (TM2.1, TM2.2) |
| US20170068698A1 | DSL (aplicação relacionada) | pipeline como plano, não execução opaca | pipeline interno: SQL parseado → logical plan → dependency graph → physical plan (DuckDB) → execution; grafo derivado das declarações input/output (TM2.3) |
| US 11,314,698 | Dynamic Pipeline Processing | builds disparam quando os inputs certos chegam, sem esperar datasets irrelevantes | scheduler incremental: commit de versão enfileira **somente descendentes afetados** (topological sort + pg-boss) — o gate da F3 (TM2.4) |
| US 11,429,572 | Rules-Based Cleaning | limpeza por regras auditáveis, não código ad hoc | Rule engine: `{condition, severity, action, scope, version, owner}`; toda violação → corrective action (quarentena) + audit event (TM2.7) |
| US 9,542,446 / US 10,678,860 | Composite Datasets | datasets derivados de múltiplos pais | `input_versions[]` multi-pai no version record; `diff` e lineage funcionam com N inputs (TM2.5) |
| US 9,922,108 / US 10,776,382 | Transformação de dados | mesmo input → mesmo output, sempre | determinismo é contrato: mesmo `VersionPin[]` → mesmo `content_hash`; `NOW()`/`RANDOM()` sem seed proibidos (TM2.1) |
| US20250265045A1 | Code Execution and Data Processing Pipeline | executar código de usuário sem derrubar a plataforma | sandbox básico: CPU/mem/timeout/fs/net restritos + identity + audit; tentativas de escape falham (TM2.9) |

Famílias da **F4 — Lineage/Policy/Security** (escopo F4a neste marco; o resto é marcado → M5):

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,996,595 | Full Data Provenance | proveniência como grafo: datasets/versions = nós, derivation = arestas | `lineage_edges`: toda pipeline_run grava `input_versions[] → output_version`; 100% dos outputs produtivos apontam seus inputs (TM2.5, TM2.6) |
| US 9,348,879 | Proveniência (família) | navegar origem de qualquer dado | `LineageService.upstream/downstream(version)` via recursive CTE (TM2.6) |
| US20140114907 | Proveniência (família) | lineage preenchido, não especulativo | `lineage_ref` (reservado no M1 — E6) passa a ser preenchido em toda run (TM2.15) |
| US20150012477 | Data Lineage | granularidade crescente de lineage | M2: granularidade dataset-version; colunar/record → M5 (nota explícita no contrato) |
| US 10,027,551 | Lineage/acesso (família) | decisão de acesso usando contexto do dado | `AuthorizeRequest.context` carrega `classification`, `tenant`, `purpose`, `environment` (TM2.11) |
| US 10,432,469 | Node-Based Access Control | permissão sobre recursos hierárquicos | policies com resource pattern (`dataset:*`, `dataset:financeiro/*`); decisão `allow/deny/partial` (TM2.11, TM2.12) |
| US 10,397,229 | Resource-creation permissions | quem pode criar o quê | operação `create` passa pelo mesmo `authorize()` que read/write (TM2.12) |
| US20150188715 | Verifiable Redactable Audit Log | audit log em que adulteração é detectável | audit append-only hash-chained: `entry_hash = sha256(prev_hash ‖ payload)`; verificador de cadeia detecta adulteração (TM2.13); **redaction de audit → M5** |
| US 8,763,078 | Authentication attempt monitoring | detectar abuso de autenticação | todo login/deny de policy emite audit event com `principal`, `result`, `reason` (TM2.14) |
| US 10,044,745 | Network-security risk | contexto de rede na decisão | campo `environment`/`network` reservado no context; avaliação de rede → M5 |
| US 9,857,960 · US 10,222,965 · US 11,327,641 · US 12,386,496 · US20250328230A1 | Inter-entity collaboration (continuations) | compartilhamento cross-org com política | → M5/M7: sem colaboração cross-org no R2; o `tenant_id` e o authorization graph (USER→GROUP→RESOURCE→POLICY) são a base |
| US 10,146,960 / US 11,720,713 | Collaborative environments / classification access | acesso por classificação | propagação **mínima** de classificação: output version herda união dos `policy_id`/classificações dos inputs (TM2.10); propagação completa → M5 |
| US 10,915,542 | Contextual sharing constraints | restrições por propósito/contexto | `purpose` no context do authorize; constraints contextuais completas → M5 |
| EP4248349 | Electronic data asset access | gate de acesso no caminho do dado | **nenhum módulo lê storage sem passar por `authorize()`** — interceptor único; default-allow do M0/M1 removido (TM2.12, gate F4) |
| WO2022245989 | Control of user actions/access | controle uniforme de ações | security matrix: toda API testada com principal allowed/denied/partial (TM2.12) |
| US 12,066,982 · US 12,353,582 · US 12,619,785 | Data-asset sharing / exploration / hierarchy permissions | compartilhamento fino de assets | → M5/M6 (R4+): resource pattern hierárquico já suportado pelo policy store |
| US20240403396A1 | Permission propagation p/ outputs de LLM | outputs de modelo preservam restrições | → M8 (AIP): a propagação de classificação do TM2.10 é o mecanismo que será estendido a model outputs |

#### O que construir

**1. Transformation engine — SQL versionado + DuckDB (F3, sem DSL própria).** `TransformationDef { name, version, sql, inputs: DatasetRef[], output: DatasetRef, validations: Rule[] }`, registrada em `transformations` (nova versão = nova linha, nunca update). `run(id, inputs: VersionPin[])` executa o SQL no DuckDB sobre os Parquets das versões **pinadas** e commita o output via `DatasetStore.commitVersion` — imutabilidade, hash e lineage de graça (E6: preenche `lineage_ref` e `policy_id` herdado). Pipeline interno: SQL parseado → logical plan → dependency graph → physical plan (DuckDB) → execution; lint rejeita funções não-determinísticas sem seed. **Parser/AST de DSL própria (o `.filter().join().derive()` da blueprint): não construir** — SQL cobre 95% do valor; DSL é UX, M6+.

**2. DAG + scheduler incremental (US 11,314,698).** O grafo de dependências é derivado das declarações input/output no registro — ciclos rejeitados no `register()`. Ao commitar qualquer versão (ingest ou transform), o scheduler calcula `dependentsOf(version)` por topological sort sobre `transformations` e enfileira **somente** os descendentes afetados via pg-boss. Cada `pipeline_run` persiste `input_versions[]`, `output_version`, `lineage_ref`, `started_at`, `duration_ms`, `quality_metrics`, `status`.

**3. Lineage por versão (US 9,996,595 — F4a).** `lineage_edges (from_version, to_version, transformation_id, run_id)`, escrita obrigatória em toda run; `LineageService.upstream/downstream(version)` por recursive CTE. Grafo RAW→TRANSFORM→DATASET; níveis OBJECT/ACTION/MODEL OUTPUT entram quando esses nós existirem (M3/M4/M8). Lineage **colunar**: nota no contrato, implementação → M5.

**4. Rule engine + data quality + quarentena (US 11,429,572).** `Rule { condition (SQL sobre a linha/dataset), severity (info|warn|error|block), action (drop|quarantine|fail_run), scope, version, owner }`, avaliadas em ordem determinística (severity desc, depois `rule_id`). Data quality pós-run por dataset: `completeness`, `uniqueness`, `validity`, `freshness` (consistency/distribution drift/schema drift → M5; schema drift de entrada já existe no M1). Linhas violadas → `quarantine_records` com motivo, severity, `rule_version` e link para o audit event — fluxo `condition → violated? → corrective action → audit event` da blueprint.

**5. Sandbox básico (US20250265045A1 — F3).** Transforms executam em processo filho isolado: limites de CPU/memória/timeout, filesystem restrito aos blobs dos inputs pinados, sem rede, sob a service account do pipeline, todo run auditado. Escape = falha de teste. Código arbitrário de usuário (UDFs): **não construir** — só SQL registrado; endurece no M5.

**6. Policy engine (F4a — o coração do marco).** `authorize(principal, resource, operation, context) → allow | deny | partial { redactedFields[] }`, único ponto de decisão — **nunca no frontend**. Policy store: `policies { policy_id, version, effect, resource_pattern, operations[], condition, owner }` + `policy_bindings { policy_id, principal|group|role }`. Avaliação: roles/groups do principal (M0) + resource pattern hierárquico + contexto (`purpose`, `environment`, `classification`, `tenant`). Enforcement: interceptor Fastify + wrapper nos reads do DatasetStore/TransformationEngine; o stub default-allow do M0/M1 é **removido** (TODO vira erro de lint). `partial` = redactedFields em payloads (semente da redaction de grafo do M5).

**7. Audit estruturado hash-chained (US20150188715).** `audit_log { seq, actor, action, resource, old_state, new_state, timestamp, reason, request_id, trace_id, prev_hash, entry_hash }`, append-only, `entry_hash = sha256(prev_hash ‖ canonical(payload))`. Todo deny de policy, quarentena, login falho e run emite evento. Verificador (`pnpm audit verify`) percorre a cadeia e detecta adulteração/ausência. Redactable audit → M5.

**8. Propagação mínima de classificação (F4a, US 10,146,960).** Se DATA A = confidential e B = transform(A), o output version herda a união dos `policy_id`/classificações dos inputs — gravada no campo reservado desde o M1 (E6). A propagação completa (colunar, via lineage, para model outputs — US20240403396A1) endurece no M5/M8.

#### Com o quê (stack)

DuckDB embedded (execução SQL determinística sobre Parquet — upgrade nomeado Spark se >100M eventos/dia) · scheduler próprio (topological sort sobre tabela de deps + pg-boss; ~200 linhas — upgrade nomeado Temporal) · Postgres 16 (policies, bindings, audit hash-chained, lineage_edges via recursive CTE) · Fastify + Zod (Transformation API, Policy API) · pino/OTel (todo run com `principal`, `trace_id`) · Vitest + Testcontainers (security matrix e fuzzing com Postgres real).

#### Contratos congelados neste marco

Congelam em `v1`: **TransformationEngine** (`register/run/dependentsOf`; `PipelineRun` com `inputVersions[] → outputVersion`, `lineageRef`, `qualityMetrics` — determinismo como cláusula contratual) e **PolicyEngine** (`AuthorizeRequest`, `Decision = allow | deny{reason} | partial{redactedFields}` — o tipo definido no M0 congela agora, sem default-allow). **LineageService** (`upstream/downstream`) congela na granularidade dataset-version, com ADR declarando que colunar é extensão v2 (M5). Definidos, congelam depois: OntologyRegistry/ObjectService (M3), ActionEngine (M4/R5).

#### Testes obrigatórios

Preservados da F3 (os 11 testes da blueprint, numerados):
- **TM2.1** (mesma entrada → mesma saída / determinismo): mesmo `VersionPin[]` → mesmo `content_hash`; SQL com `NOW()` sem seed rejeitado no registro.
- **TM2.2** (parser da DSL / AST determinístico): adaptado — o SQL é parseado para extrair dependências e o plano lógico é estável para o mesmo texto; AST de DSL própria → M6+ (teste pendente registrado).
- **TM2.3** (dependency graph): grafo derivado das declarações input/output; registro com ciclo é rejeitado (ciclo no DAG).
- **TM2.4** (incremental recompute — **gate F3**): mudar apenas RAW_C recalcula exatamente e somente os descendentes afetados; `pipeline_runs` prova que T1 não rodou (dependency invalidation).
- **TM2.5** (composite/lineage de run): transform com N inputs persiste `input_versions[]` completo e edges corretas.
- **TM2.6** (lineage completeness — também teste da F4): 100% dos outputs produtivos apontam para seus inputs; `upstream/downstream` navegam o grafo inteiro.
- **TM2.7** (rule ordering): regras avaliadas em ordem determinística documentada; violação → quarentena com motivo + audit event.
- **TM2.8** (failure propagation): falha num transform marca descendentes como `blocked`, nunca executa com input faltante; recovery re-enfileira após correção.
- **TM2.9** (sandbox escape attempts): tentativas de ler fs fora do permitido, abrir socket e estourar memória/timeout falham e são auditadas.
- **TM2.10** (schema changes em transform): mudança de schema num input é classificada (classifier do M1); breaking pausa o transform dependente com alerta, nunca produz output silenciosamente errado.
- **TM2.11** (replay usando versões antigas): reprocessar janela histórica com inputs pinados → output com hash idêntico ao original.

Preservados da F4 (escopo F4a; o resto adiado):
- **TM2.12** (Security matrix): harness gerado por tabela — para **toda** API (datasets, transforms, lineage, policies), três principals: allowed / denied / partially allowed; denied recebe 403 indistinguível de 404; partial recebe redactedFields.
- **TM2.13** (Tamper detection — audit): alterar ou apagar uma linha do `audit_log` é detectado pelo verificador de cadeia de hash.
- **TM2.14** (authn/authz monitoring): login falho e deny de policy emitem audit event completo.
- **TM2.15** (E6): `policy_id`/`lineage_ref` preenchidos em 100% das versões produzidas por transforms; output herda classificação dos inputs (propagação mínima).
- **Noninterference** (F4): versão essencial aqui — principal negado não infere informação por **quantidade de resultados** (count filtrado), **erro diferente** (403≡404) ou **logs** (sem payload de recurso negado no log). Os canais restantes — autocomplete, search index, embeddings, cache, LLM — só existem a partir do M4/M6/M8: teste completo **adiado ao M5** (registrado).
- **Authorization fuzzing** (principal × resource × action × context): versão smoke sobre a security matrix (combinações geradas automaticamente sobre as APIs do R2); fuzzing completo **→ M5**.
- **Redaction de grafo** (remove nós/propriedades + repara arestas): **→ M5** — não existe grafo de objetos ainda; `partial/redactedFields` é a semente.

**Gate de saída M2 (= gates F3 + F4 originais):** (1) mudar 1 input reconstrói exatamente e somente os outputs dependentes, com grafo input→output visível com hashes; (2) **nenhum componente lê dados do storage ignorando o policy layer** — provado por teste que tenta bypass direto no DatasetStore e falha; (3) security matrix verde para todas as APIs do R1+R2; (4) verificador de cadeia do audit detecta adulteração injetada.

#### Tasks para o Cursor (036–060)

1. `036` Contrato **TransformationEngine** v1 (zod/TS): `TransformationDef`, `VersionPin`, `PipelineRun`; golden fixtures + teste de contrato.
2. `037` Contrato **PolicyEngine** v1: `AuthorizeRequest`, `Decision` (congela o tipo do M0, remove default-allow) + ADR-0005 "decisão nunca no frontend".
3. `038` Migration SQL 0003: `transformations`, `pipeline_runs`, `lineage_edges`, `quality_metrics`, `quarantine_records` — revisada linha a linha.
4. `039` Migration SQL 0004: `policies`, `policy_bindings`, `audit_log` (com `seq`, `prev_hash`, `entry_hash`, trigger append-only) — revisada linha a linha.
5. `040` `TransformRunner`: executa SQL DuckDB sobre Parquets de `VersionPin[]` → `commitVersion` do output (preenchendo `lineage_ref`, herdando `policy_id`).
6. `041` Determinismo: lint de SQL anti-`NOW()`/`RANDOM()` sem seed + teste TM2.1 (mesmo input → mesmo hash).
7. `042` DAG: derivação do grafo input/output, rejeição de ciclo no `register()` (TM2.3), topological sort.
8. `043` Scheduler incremental: hook pós-commit → `dependentsOf()` → enfileira só descendentes (pg-boss); teste TM2.4 (gate F3).
9. `044` `LineageService`: grava edges em toda run + `upstream/downstream` via recursive CTE; testes TM2.5 e TM2.6.
10. `045` Data quality v0: completeness/uniqueness/validity/freshness pós-run persistidas em `quality_metrics`.
11. `046` Rule engine v0: modelo `Rule`, avaliação ordenada determinística; teste TM2.7.
12. `047` Quarentena: linhas violadas → `quarantine_records` com motivo/severity/rule_version + audit event.
13. `048` Failure propagation: status `blocked` em descendentes de run falha + recovery; teste TM2.8.
14. `049` Sandbox básico: processo filho com limites CPU/mem/timeout, fs restrito, sem rede, service account; teste TM2.9 (escape attempts).
15. `050` Schema change em transform: integração com drift classifier; breaking pausa dependentes; teste TM2.10.
16. `051` Replay histórico: run com inputs pinados antigos → hash idêntico; teste TM2.11.
17. `052` Policy store: `policies`/`policy_bindings` versionadas + admin API (create policy passa pelo próprio `authorize` — US 10,397,229).
18. `053` `PolicyEngine.authorize()` impl: roles/groups + resource pattern hierárquico + contexto (classification/tenant/purpose) → allow/deny/partial.
19. `054` Enforcement: interceptor Fastify + wrapper de reads do DatasetStore/Transform; remover stub default-allow; teste de bypass falhando (gate F4).
20. `055` Security matrix harness: tabela de principals × APIs gerando os 3 casos; teste TM2.12 em todas as rotas R1+R2 + re-execução do TM1.7 agora no caminho de leitura.
21. `056` Audit writer: `audit_log` hash-chained, canonicalização do payload, emissão em deny/login falho/quarentena/run; testes TM2.13 (tamper) e TM2.14.
22. `057` Verificador de cadeia (`pnpm audit verify`) + teste de detecção de adulteração e de gap de sequência.
23. `058` Propagação mínima: output herda união de classificações dos inputs + noninterference essencial (count filtrado, 403≡404, log sem payload negado); teste TM2.15 + noninterference essencial.
24. `059` Authorization fuzzing smoke: gerador principal × resource × action × context sobre a matrix, invariante "nunca 500, nunca vazamento"; nota "completo → M5".
25. `060` ADR-0006 "SQL+DuckDB em vez de DSL própria" + ADR-0007 "audit hash-chained, redaction adiada ao M5" + `docs/arch/transform.md` + `docs/arch/policy.md`. Gate M2/R2 verde.

---

# PARTE B — MARCOS M3–M5: ER+ONTOLOGY, LOOP OPERACIONAL, SECURITY HARDENING

### M3 — ENTITY RESOLUTION + ONTOLOGY JUNTAS (cobre F7-lite + F6 da blueprint original · Release R3)

**Por que nesta posição:** M3 é o primeiro momento de valor de negócio visível: registros
de fontes diferentes convergem para um único objeto semântico com proveniência
("ACME LTDA" do ERP e "Acme Ltda." do CRM viram um `Customer`). Ele só pode ser o quarto
porque exige o store versionado (M1), as transforms que produzem os datasets limpos (M2)
e o lineage por versão já gravado. Fica antes do loop operacional porque Actions (M4)
operam sobre objetos — sem Ontology não existe alvo para agir.

**Erros corrigidos aqui:** **E3 — a circularidade F6↔F7.** Na ordem literal da blueprint,
F6 (Entity Resolution) vem antes de F7 (Ontology), mas o próprio texto da F6 se
contradiz: o candidate generation lista "ontology neighborhood" e "relationships" como
fontes de candidatos — coisas que só existem na F7 — e a patente que a blueprint destaca,
US20250165857A1, descreve resolução *contra entidades já presentes numa ontology*, com
feedback melhorando resoluções futuras. Na direção oposta, uma Ontology sem ER
materializa duplicatas: cada fonte vira um objeto e o grafo operacional nasce fragmentado
— o gate da F6 ("só avançar para Ontology quando a identidade canônica for confiável")
é literalmente impossível de cumprir, porque não existe para onde resolver identidades.
**A correção é construir as duas juntas, convergindo no mesmo marco:** a Ontology-lite
fornece o alvo (ObjectType + canonical entities), o ER preenche essa Ontology com
identidades reconciliadas, e cada revisão humana retroalimenta as regras de matching. O
feedback loop que a patente descreve vira um invariante nosso: `entity_matches.review`
alimenta `rule_version` seguinte.

#### Patentes → problema técnico → invariante

Família: **Entity Resolution (F6)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,554,719 | Entity resolution | Mesma entidade com identificadores diferentes em sistemas distintos | Todo `source_record` aponta para exatamente 1 canonical entity; link nunca destrói o original (T3.9) |
| US 9,501,552 | Entity resolution | Comparação O(n²) inviável em escala | Blocking por SQL indexado; zero comparações fora do bloco; teste prova que 2 registros sem chave de bloco comum nunca são comparados (T3.6) |
| US 9,846,731 | Entity resolution | Decisão de match precisa ser auditável e reproduzível | `entity_matches` persiste score, features, rule_version, decision, reason, timestamp; mesmo input + mesma rule_version → mesma decision (T3.7) |
| US 12,229,154 | Focused Probabilistic ER | Scoring focado nos candidatos relevantes, não no universo inteiro | Scoring só roda sobre candidatos do bloco; métrica de candidate-set size monitorada |
| US20250165857A1 | ER baseado em estruturas da Ontology (pending) | Resolver registros contra entidades já presentes na ontology, usando feedback | ER resolve contra `objects` canônicos existentes (não contra tabela solta); decisões humanas da fila de revisão alteram o resultado de matches futuros na próxima rule_version (T3.10) |
| US 12,393,406 / US20250348288A1 | Entity search por copy-detection | Encontrar entidade por similaridade de conteúdo copiado/derivado | Features incluem igualdade exata de atributos fortes (CNPJ, email); teste com registro copiado entre fontes → match com score 1.0 |
| US20140280252 | Comparing/associating objects | Comparar e associar objetos de tipos compatíveis | Scoring só compara records mapeados para o mesmo ObjectType (ou InterfaceType comum); teste de tipo incompatível → sem candidato |
| US 8,788,405 | Clusters | Agrupar matches transitivos sem merges espúrios | Merge forma cluster canônico por componente conexo; false merge rate medido no gold set ≤ alvo (T3.8) |
| US 8,818,892 | Cluster prioritization | Priorizar clusters incertos para revisão humana | Fila de revisão ordenada por proximidade ao threshold; revisão do topo reduz manual review rate na medição seguinte |

Família: **Dynamic Ontology (F7)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 7,962,495 | Dynamic Ontology | Schema semântico evolui sem parar o sistema | Toda mudança de ObjectType gera nova `ontology_version`; nunca UPDATE in-place (T3.3) |
| US 8,489,623 | Dynamic Ontology | Mapear dados físicos para modelo semântico | Mapping declarativo coluna→property, versionado, validado contra o schema do dataset no bind (T3.2) |
| US 8,856,153 | Dynamic Ontology | Múltiplas versões de ontology coexistindo | Leitura histórica `getObject(at)` usa a ontology_version vigente no timestamp; teste com 3 versões simultâneas (T3.12) |
| US 9,201,920 | Dynamic Ontology | Adicionar/deprecar properties sem quebrar leitores | Property nova é nullable por padrão; deprecated continua legível; deleted property só em versão nova (T3.4) |
| US 9,589,014 | Dynamic Ontology | Renomear/trocar tipo com migração controlada | Rename = property nova + migração declarativa; type change incompatível rejeitado sem migration explícita (T3.4) |
| US 10,872,067 | Dynamic Ontology | Rollback de definição semântica | `ontology rollback` = apontar versão corrente para versão anterior, sem apagar histórico (T3.11) |

Família: **Object Modeling (F7)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20100070426 | Object Modeling | Objeto como representação lógica única de dados físicos dispersos | 1 objeto = projeção de N source_records; `provenance` lista todos (T3.9) |
| US 9,229,966 | Object Modeling | Validação estrutural de instâncias contra o tipo | Property inválida/ausente rejeitada na projeção e registrada em quarentena de objetos (T3.5) |

Família: **Object Platform (F7)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,691,729 | Object Platform | API de objetos estável e independente de UI | Gate F7: operação completa via Object API sem nenhuma UI ligada |
| EP3425537A1 | Object Platform | Histórico de revisões do objeto | `object_history` append-only; `getHistory` retorna toda a cadeia com motivo da revisão |

Família: **Knowledge Graph (F7)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20250077899A1 | Knowledge Graph | Grafo operacional vivo como instanciação da ontology | `traverseLinks` sobre `objects`+`links` via recursive CTE; integridade referencial: link sem destino é rejeitado (T3.5) |

Família: **Remote object references (F7)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,378,526 | Remote object references | Referenciar objetos de forma estável entre contextos | `object_id` opaco e imutável; canonical entity nunca muda de id em merge (T3.9) |
| US 9,621,676 | Remote object references | Referências resolúveis mesmo após evolução de schema | Resolução de objeto independe de ontology_version; teste lê objeto criado na v1 com registry na v3 |
| US 9,906,623 | Remote object references | Links como referências tipadas e verificáveis | LinkType declara cardinalidade e tipos das pontas; violação rejeitada na materialização (T3.5) |

Família: **Rich objects / spreadsheet integration (F7)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,280,532 | Rich objects | Objeto carrega contexto suficiente para consumo direto por aplicações | `getObject` retorna properties + links + provenance + policy_tags em uma chamada |
| US 9,880,993 | Rich objects | Sincronização de representações derivadas do objeto | Objetos são projeção reprocessável: replay do mapping a partir de dataset_version antiga reconstrói estado equivalente (T3.13) |

Família: **Ontology index/query evolução (F7)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 11,816,156 | Ontology index/query | Consulta sobre objetos sem varredura | `queryObjects` resolve por índices Postgres sobre (object_type, property jsonb); p95 medido com 100k objetos |
| US 12,561,339 | Unified query across ontology DBs | Interface de query única sobre múltiplas fontes de objetos | `queryObjects` é a ÚNICA porta de leitura de objetos — proibido SQL direto em `objects` fora do módulo ontology (regra de fronteira, endurece no M4) |

#### O que construir

**Ontology Registry (semântica).** Tabelas `object_types`, `property_types`,
`link_types`, `ontology_versions`. `ObjectType = { id, version, properties{}, links{},
policies[] }`; `ActionType`, `FunctionType`, `InterfaceType` e `PolicyBinding` entram como
**tipos registrados mas vazios** — a separação semântico/cinético é estrutural desde já:
a camada semântica (Object/Property/Link — "o que existe") é construída aqui; a cinética
(Function/Action/Workflow — "o que pode acontecer") só ganha instâncias no M4. Mudança de
qualquer definição cria nova `ontology_version` monotônica; nunca update in-place.
`OntologyVersion = { version, changeset, created_at, created_by, parent_version }`.

**Mapping versionado.** `MappingDef` em JSON declarativo: `{ datasetRef, objectType,
ontologyVersion, columnMap: { coluna_fisica → property_id }, keyStrategy, version,
created_by }`. O `bindMapping` valida cada coluna contra o `schema_registry` do dataset e
cada property contra o ObjectType. Reprocessamento com mapping novo = replay pinado.

**Projetor dataset→objeto.** Worker pg-boss: nova `dataset_version` com mapping bound →
upsert em `objects`; toda mutação grava `object_history` (append-only) com
`provenance = { dataset_version_id, event_ids[], mapping_version }`. É aqui que o lineage
dataset→object nasce: `lineage_edges` (M2) ganha tipo de nó `OBJECT`, aresta
`dataset_version → object_revision`. `getProvenance(objectId)` navega objeto → versão →
evento fonte (CanonicalEvent).

**ER pipeline (determinístico, sem ML).** Cinco estágios sobre SQL:
(1) **normalização** — lowercase, remoção de acentos/pontuação, CNPJ/CPF só dígitos,
email minúsculo, telefone E.164-ish; (2) **blocking** — candidatos por chave exata
(documento, email), nome normalizado (trigram index `pg_trgm`) e telefone; nunca
comparação fora do bloco; (3) **scoring por regras ponderadas** — ex.: documento = 1.0;
nome+cidade = 0.8; nome só = 0.4; thresholds configuráveis match / no-match / review;
(4) **decisão** — `entity_matches` persiste candidate, score, features, rule_version,
decision, reason, review, timestamp (exigência literal da F6); (5) **revisão humana** —
fila `er_review_queue` (tabela + endpoint) para a zona cinzenta; a decisão humana grava
`review` e alimenta a próxima `rule_version`.

**Canonical entities.** Match confirmado → merge: cria-se/usa-se canonical entity, todos
os `source_record → canonical` viram links, originais preservados. Clusters por componente
conexo do grafo de matches; false merge é a métrica crítica (contamina o grafo
operacional inteiro).

**Gold set + métricas.** 50 pares rotulados à mão (MATCH/NO_MATCH) em
`packages/testing/goldset/`. Script de métricas: **precision, recall, F1, false merge
rate, false split rate, manual review rate** — as seis da F6, sem exceção.

**Corte explícito — ML de ER (embeddings / modelo probabilístico): NÃO construir.**
Justificativa: sem gold set grande e curado, modelo probabilístico vira fábrica de false
merges; regras ponderadas com chaves fortes (CNPJ, email) alcançam F1 alto com zero
custo de treino e total auditabilidade (cada score é explicável por features). O contrato
`model_version` já existe em `entity_matches`, então um scorer por embeddings (pgvector)
pode entrar depois como `rule_version` nova sem mudar schema — upgrade nomeado, não
dívida. Também ficam fora: links inferidos (só materializados do mapping) e security por
property (M4).

#### Com o quê (stack)

Postgres 16 para registry, objetos, links e `entity_matches` (jsonb para properties) ·
`pg_trgm` para blocking por nome — índice GIN nativo, sem infra nova · recursive CTE para
`traverseLinks` (grafo em Postgres nesta fase, conforme premissa) · pg-boss para o
projetor e o ER runner (mesma mensageria do M1/M2) · Fastify + Zod para a Object API ·
Vitest + Testcontainers para gold set e gates · `packages/contracts/v1` para
OntologyRegistry/ObjectService/ER API.

#### Contratos congelados neste marco

Congelam: **OntologyRegistry** (`defineObjectType/getObjectType/defineLinkType/
bindMapping`), **ObjectService** (`getObject(at?)/queryObjects/traverseLinks/getHistory/
getProvenance`) e **ER API** (`runResolution/getMatches/submitReview/getMetrics`) — a
Ontology API congela na R3 como previsto. Definidos já mas congelam depois: ActionEngine
(M4), PolicyEngine.authorize (M4 — ObjectService chama authorize desde já, em modo
default-allow marcado com TODO + security matrix pendente, conforme contrato).

#### Testes obrigatórios

Renumerados da blueprint original:
**T3.1** criação de object type · **T3.2** mapping (bind válido/inválido) · **T3.3**
atualização de ontology → nova versão · **T3.4** migrations de schema: rename, type
change, add, deprecated, **deleted property** · **T3.5** invalid property, invalid link,
referential integrity · **T3.6** blocking nunca compara fora do bloco · **T3.7** scoring
determinístico por rule_version · **T3.8** métricas no gold set: precision, recall, F1,
false merge rate, false split rate, manual review rate (gate F6: identidade canônica
demonstrada quantitativamente; false merge ≤ alvo definido) · **T3.9** merge não destrói
original; id canônico estável; provenance completa · **T3.10** feedback de revisão altera
matches futuros · **T3.11** ontology rollback · **T3.12** historical object read +
multiple ontology versions · **T3.13** replay de mapping reconstrói estado equivalente ·
**T3.14** traversal multi-hop via recursive CTE.
Novos (erros corrigidos): **T3.15** (E3) ER resolve contra objetos canônicos existentes
da Ontology — prova de que a circularidade foi fechada; **T3.16** lineage dataset→object:
100% dos objetos têm `getProvenance` navegável até o evento fonte.
**Gate de saída (F7, literal):** desligar qualquer UI e operar exclusivamente pelas APIs
da Ontology — se não for possível, lógica vazou para fora da camada. Aceite R3:
precision/recall medidos no gold set de 50 pares, false merge documentado,
`getProvenance` navegando objeto→versão→evento.

#### Tasks para o Cursor

061. Contratos v1: OntologyRegistry + ObjectService + ER API (zod) + golden fixtures em `packages/testing`.
062. Migration: `object_types`, `property_types`, `link_types`, `ontology_versions` — revisar linha a linha.
063. Migration: `objects`, `object_history`, `links`, `entity_matches`, `er_review_queue`, `mappings`.
064. OntologyRegistry: `defineObjectType` versionado (mudança → nova `ontology_version`, nunca in-place) + testes T3.1/T3.3.
065. PropertyType/LinkType: tipos primitivos, cardinalidade, tipos das pontas + validação (T3.5 parcial).
066. `bindMapping`: mapping declarativo versionado + validação contra `schema_registry` do dataset (T3.2).
067. Projetor: dataset_version → upsert `objects`; `object_history` append-only com provenance (T3.9 parcial).
068. Lineage dataset→object: estender `lineage_edges` com nó OBJECT; `getProvenance` navega até o CanonicalEvent (T3.16).
069. ER normalização: lowercase, sem acentos/pontuação, CNPJ só dígitos, email/telefone canônicos + testes de tabela.
070. ER blocking: chave exata + trigram `pg_trgm` + telefone; prova de zero comparações fora do bloco (T3.6).
071. ER scoring por regras ponderadas + thresholds match/no-match/review + determinismo por rule_version (T3.7).
072. Persistência `entity_matches`: score, features, rule_version, decision, reason, timestamp (exigência F6).
073. Canonical entities: merge + links `source_record→canonical` sem destruir original; cluster por componente conexo (T3.9).
074. Gold set (50 pares rotulados) + script de métricas: precision/recall/F1/false-merge/false-split/review-rate (T3.8).
075. Fila de revisão humana: endpoint + decisão grava `review` e alimenta próxima rule_version (T3.10).
076. ObjectService: `getObject(at?)/queryObjects` com authorize default-allow marcado + índices jsonb (T3.12 parcial).
077. `traverseLinks` (recursive CTE) + `getHistory` (T3.14) + `getProvenance` na API.
078. Links materializados do mapping (FK cruzada entre fontes) com integridade referencial (T3.5).
079. Bateria de gates F7: rename/type-change/deleted property, invalid property/link, rollback, múltiplas versões (T3.4/T3.11/T3.12/T3.13).
080. ADR "objetos como projeção versionada, não cópia mutável" + `docs/arch/ontology-er.md` + verificação do gate F7 (operação só por API) e gate F6 (métricas no gold set).

### M4 — LOOP OPERACIONAL + POLICY/AUDIT NÚCLEO (cobre F4 núcleo, F8 e F9-lite da blueprint original · Releases R4–R5)

**Por que nesta posição:** com objetos canônicos existindo (M3), a plataforma pode
executar pela primeira vez o ciclo que a própria blueprint define como produto:
observe→decide→act→write-back. Mas uma Action sem enforcement real é perigosa — então o
núcleo da F4 (authorize central, roles/groups, audit verificável, propagação básica de
classificação) entra **antes** da primeira escrita (R4), e o Action engine + Functions +
busca permission-aware fecham a R5. É também aqui que a 2ª fonte de dados entra, provando
que links e autorização funcionam multi-fonte.

**Erros corrigidos aqui:** **E2** — F4 dividida em três; este marco entrega a segunda
fatia (núcleo: access control, audit hash-chained, auth monitoring; F4a já veio no
M0–M2; o hardening fica no M5). E a **dependência oculta F8→F1** que a blueprint não
declara: o write-back passa por connectors. Explicitamos: o Connector ganha um contrato
de escrita (`write-back`) e a Action o invoca — o ciclo F1→…→F8→F1 é deliberado e só é
seguro porque connectors são plugáveis e nunca importam a Ontology.

#### Patentes → problema técnico → invariante

Família: **F4 núcleo — access control, audit verificável, auth monitoring**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,432,469 | Node-Based Access Control | Autorização avaliada sobre o nó (recurso/objeto/property), não só por papel global | `authorize(principal, resource, operation, context)` é o ÚNICO ponto de decisão; security matrix com allowed/denied/partial por API (T4.1) |
| US 10,397,229 | Resource-creation permissions | Permissão para criar recursos é decisão distinta de ler/escrever | Operação `create` passa por authorize como qualquer outra; teste de principal sem grant de criação → denied |
| US20150188715 | Verifiable Redactable Audit Log | Audit log cuja adulteração é detectável | Cadeia de hash: cada entrada carrega `prev_hash`; verificação detecta qualquer alteração/remoção (T4.2) |
| US 8,763,078 | Authentication attempt monitoring | Tentativas de acesso (válidas e negadas) precisam ser registradas e monitoradas | Todo authorize → audit event (allow E deny); alerta por burst de denies do mesmo principal (T4.3) |

Família: **Workflow / document workflow (F8)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,429,194 | Document workflow | Mudança de estado com trilha de aprovação e auditoria | Toda Action grava ActionRun + audit entry com reason; audit trail completo do ciclo (T4.11) |
| US 8,905,597 | Document workflow | Fluxo orientado a documento/objeto, não a tarefa solta | Action tem `targets: ObjectId[]` obrigatórios — não existe Action sem objeto alvo |

Família: **Workflow parameterization/generation (F8)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,732,574 | Workflow parameterization | Parametrizar execução com validação prévia | `parameterSchema` (zod) valida antes de qualquer efeito; `validation_failed` sem side effect (T4.7) |
| US 9,058,315 | Workflow generation | Definição declarativa e reutilizável de operação | ActionDef declarativo registrado em store versionado; mesma definição executável por UI, API ou (futuro) agente |
| US 9,880,987 | Workflow parameterization | Execução repetida sem efeito duplicado | `idempotencyKey` obrigatório; retry retorna o ActionResult original sem reexecutar (T4.8) |
| US 10,706,220 | Workflow generation | Condições de entrada/saída verificáveis | Preconditions e postconditions avaliadas na tx; violação aborta antes do commit (T4.6/T4.7) |

Família: **Document generation (F8)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,223,773 | Document generation | Produzir artefato derivado a partir de objetos com rastreabilidade | Function outputs carregam lineage (quais objetos alimentaram o resultado); artefato gerado referencia object_ids + versões |

Família: **Object-based process management (F8)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20240386347A1 / EP4465217 | Object-based process management | Processos gerenciados sobre o estado dos objetos | Precondition lê o estado atual do objeto na tx; stale object → conflict, nunca escrita silenciosa (T4.9) |

Família: **Interactive workflow analysis (F8)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20260017035A1 | Interactive workflow analysis | Tornar execução inspecionável pelo operador | ActionRun expõe pipeline completo (authorize→validate→tx→write-back→audit) com status por estágio, consultável via API |

#### O que construir

**R4 — Policy/Audit núcleo.**
`PolicyEngine.authorize()` sai do modo default-allow: tabelas `roles`, `groups`,
`group_members`, `policy_rules` implementam o authorization graph da blueprint
(USER→role→GROUP→permission→RESOURCE→policy→PROPERTY/ACTION). Decisão:
`allow | deny{reason} | partial{redactedFields}` — security por property nasce aqui como
`partial` aplicado pelo ObjectService. **Regra de enforcement:** nenhum módulo lê ou
escreve storage sem passar por `authorize()` — o gate literal da F4 ("nenhum componente
pode ler dados diretamente do storage ignorando o policy layer") passa a valer para todos
os módulos construídos até aqui (ingest, transform, ontology).
**Audit hash-chained:** tabela `audit_log` com actor, action, resource, old_state,
new_state, timestamp, reason, request_id (campos exatos do audit graph da F4) +
`prev_hash`/`entry_hash` (sha256 encadeado); verificação de cadeia detecta adulteração.
**Auth monitoring:** todo authorize gera evento (allow e deny); contador de denies por
principal com alerta.
**Propagação de classificação via lineage (nível 1):** `policy_tags` do dataset (campo
reservado desde a R1) propagam para os objetos projetados e para datasets derivados —
B = transform(A) não perde classificação. Neste marco a propagação é em granularidade de
dataset/objeto; a colunar endurece no M5.
**2º connector** (CSV ou REST, conforme o domínio do slice) usando o mesmo SDK — revalida
o gate da F1 ("nova fonte sem alterar o core"). **Links multi-fonte:** mappings das duas
fontes materializam links entre objetos (Customer↔Order etc.).

**R5 — Loop operacional.**
**Function registry:** `FunctionDef { id, version, inputObjectTypes[], parameterSchema,
implementation, outputSchema }`; Function não altera estado — `f(objects) → result` —
resultado registra quais objetos/versões alimentaram o cálculo.
**Action engine:** `ActionDef { action_id, input_object_types, parameter_schema,
preconditions, authorization_policy, validation, side_effects, postconditions,
audit_requirements }` (campos da blueprint; `transaction` é a tx do pipeline,
`compensation` fica declarativa — ver corte). Pipeline **FIXO**:
**authorize → validate → tx → write-back → audit**. Ninguém — UI, script ou, futuramente,
LLM — escreve direto no banco.
**Optimistic concurrency:** `expectedObjectVersions` no ActionRequest; divergência →
`conflict` com `currentVersions`, nunca escrita silenciosa.
**Idempotency:** `idempotencyKey` obrigatório em toda action com efeito externo; replay
retorna o resultado original.
**Write-back volta pelo connector (dependência F8→F1, explícita):** o contrato Connector
é estendido (v2, via ADR) com `writeBack(spec)`; `side_effects: WriteBackSpec[]` da
ActionDef são executados pelo connector da fonte correspondente — o mesmo runtime, as
mesmas credenciais e o mesmo audit da ingestão. A Action nunca fala SQL com o sistema
externo diretamente.
**Partial external failure:** write-back com status tracked (pending/succeeded/failed);
falha → retry com backoff ou fila `manual_resolution`. **Compensação declarativa
mínima:** ActionDef pode declarar `compensatingActionId`, executada manualmente.
**F9-lite — busca permission-aware de objetos:** endpoint de busca sobre `objects` via
Postgres FTS/trigram, filtrado por authorize **antes** de retornar — hit, count e snippet
só incluem objetos permitidos (Meilisearch com ACL no índice entra no M6/R6; aqui o
objetivo é provar a semântica, não a escala).

**Corte explícito — workflow engine genérico com saga: NÃO construir.** Justificativa: a
R5 entrega Action de 1 passo com idempotência, conflict e compensação declarativa; um
engine multi-step (state/timeout/retry/approval/branching/wait/external event/saga) é um
produto inteiro que só se justifica com o 2º caso de uso real de processo, e o Temporal
já está nomeado como upgrade. Consequência: os testes de workflow da F8 (workflow
restart, cycle detection, timeout, retry, manual approval) ficam **adiados
explicitamente** para o marco em que o engine existir — não são descartados, são
re-atribuídos; todos os testes de Action são preservados aqui.

#### Com o quê (stack)

Postgres 16 para policy store, audit_log (append-only + trigger anti-UPDATE/DELETE) e
action_runs · sha256 encadeado no audit (implementação própria, ~100 linhas) · Fastify +
Zod (parameterSchema das Actions é Zod — mesma fonte de validação dos contratos) ·
pg-boss para retry de write-back · connector CSV/REST novo em `connectors/` dependendo só
de contracts · Postgres FTS + `pg_trgm` para a busca F9-lite (Meilisearch é upgrade do
M6) · Vitest + Testcontainers; Playwright para o aceite do loop na tela.

#### Contratos congelados neste marco

Congelam: **PolicyEngine.authorize** (R4 — como previsto, tipos já existiam desde a R1) e
**ActionEngine** + **Function API** (R5: ActionDef/ActionRequest/ActionResult com o
pipeline fixo). Estendido com ADR: **Connector v2** acrescenta `writeBack(WriteBackSpec)`
— aditivo, não breaking. Definido já, congela depois: Search API (M6).

#### Testes obrigatórios

F4 núcleo (renumerados): **T4.1** security matrix — para toda API: allowed, denied,
partially allowed (preservado da F4) · **T4.2** tamper detection — alterar/remover
entrada do audit log é detectado pela verificação de cadeia de hash · **T4.3** auth
monitoring — denies registrados e alerta por burst · **T4.4** propagação de
classificação: dataset confidencial → objeto herda policy_tags; transform de dataset
confidencial → output herda · **T4.5** usuário sem permissão não vê objeto **nem o
count** na busca F9-lite (critério R4).
F8 Actions (preservados): **T4.6** precondition (falha → abort sem efeito) · **T4.7**
postcondition + validation_failed · **T4.8** duplicate action — mesmo idempotencyKey →
sem reexecução · **T4.9** stale object — expectedObjectVersions divergente → conflict ·
**T4.10** unauthorized action — actor sem grant → denied, zero efeito · **T4.11** audit
trail — toda Action committed gera cadeia auditável completa · **T4.12** partial external
failure — write-back falha → retry ou manual_resolution, estado nunca "committed" falso ·
**T4.13** loop fechado: write-back muda a fonte → connector detecta → nova versão →
projetor atualiza objeto → estado observável converge. Adiados com o workflow engine:
workflow restart, cycle detection, timeout, retry, manual approval (registrado em ADR).
Novos: **T4.14** enforcement total — teste de arquitetura que varre módulos e prova que
nenhum acessa storage sem authorize (gate literal da F4) · **T4.15** 2º connector entra
sem alterar o core (revalidação do gate F1).
**Gate de saída (F8, literal):** observe state → calculate → decide → execute authorized
action → observe resulting state — demonstrado end-to-end na tela com
`ReclassifyCustomer`; audit mostra o ciclo inteiro.

#### Tasks para o Cursor

081. Congelar contrato PolicyEngine (v1) + fixtures: Principal, ResourceRef, Decision (allow/deny/partial).
082. Migration: `roles`, `groups`, `group_members`, `policy_rules`, `audit_log` (com prev_hash) — revisar linha a linha.
083. Policy store: CRUD de roles/groups/grants implementando o authorization graph USER→GROUP→RESOURCE.
084. `authorize()` real: avaliação de regras + decisão partial com redactedFields + testes unitários.
085. Enforcement: middleware de authorize em TODOS os módulos (ingest, transform, ontology) + T4.14 (varredura arquitetural).
086. Harness de security matrix: runner allowed/denied/partial por API (T4.1) integrado ao CI.
087. Audit service: append hash-chained com actor/action/resource/old_state/new_state/reason/request_id (T4.11 base).
088. Verificador de cadeia de hash + T4.2 (tamper detection: UPDATE/DELETE detectados).
089. Auth monitoring: evento por authorize (allow+deny) + alerta por burst de denies (T4.3).
090. Propagação de classificação: policy_tags dataset→objeto e dataset→dataset derivado via lineage_edges (T4.4).
091. Security por property: ObjectService aplica `partial.redactedFields` na leitura + testes.
092. 2º connector (CSV ou REST) com o SDK existente, sem tocar o core (T4.15).
093. Links multi-fonte: mappings das 2 fontes materializando links + traverse cruzado.
094. Busca F9-lite: Postgres FTS/trigram sobre objects filtrado por authorize — hit/count/snippet (T4.5).
095. Congelar contratos ActionEngine + Function API (v1) + fixtures de ActionDef/ActionRequest/ActionResult.
096. Migration: `function_defs`, `action_defs`, `action_runs`, `idempotency_keys`, `writeback_runs`.
097. Function registry: register/call, `f(objects)→result`, resultado com lineage de inputs.
098. Action engine — estágio authorize: authorizationPolicy do ActionDef → denied sem efeito (T4.10).
099. Estágio validate: parameterSchema (zod) + preconditions na tx → validation_failed (T4.6/T4.7).
100. Estágio tx: mutação de objects com expectedObjectVersions → conflict com currentVersions (T4.9).
101. Idempotency: tabela idempotency_keys; replay retorna ActionResult original (T4.8).
102. ADR + Connector v2: `writeBack(WriteBackSpec)` — write-back executado pelo connector da fonte (dependência F8→F1 explícita).
103. Estágio write-back + audit: writeback_runs com status tracked; audit fecha o pipeline (T4.11).
104. Partial external failure: retry com backoff (pg-boss) + fila manual_resolution + compensatingActionId declarativo (T4.12).
105. Vertical slice R5: `ReclassifyCustomer` end-to-end (write-back→fonte→connector→versão→objeto→audit) + Playwright + ADR "workflow engine genérico adiado" + gate F8 (T4.13).

### M5 — SECURITY HARDENING (cobre F4 completa da blueprint original · track pós-R5)

**Por que nesta posição:** endurecer propagação de classificação, redaction e
noninterference antes de existirem transforms, objetos, functions e actions reais é
especular sobre caminhos de dados que ainda não existem. Depois da R5 há um loop
operacional completo — dados fluem de fontes por transforms para objetos, Functions e
Actions — e é sobre esses caminhos concretos que o hardening da F4 se aplica. É track
pós-R5, não release com escopo novo de produto: só endurece o que já existe.

**Erros corrigidos aqui:** **E2** — terceira e última fatia da F4 (F4a no M0–M2: policy
engine e audit estruturado; núcleo no M4: authorize real, audit hash-chained, auth
monitoring; aqui: lineage colunar, redaction, cross-classification, sharing constraints,
propagação para outputs de modelo, noninterference total, fuzzing, tamper detection
avançado).

#### Patentes → problema técnico → invariante

Família: **Provenance / Data Lineage (hardening colunar)** — *a granularidade de dataset
desta família já foi mapeada no M2 (lineage por versão); aqui endurece para coluna,
propriedade e model output.*

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,996,595 | Full Data Provenance | Proveniência como grafo: datasets/versões são nós, derivações são arestas — estendido a coluna, objeto, property, action, model output | Grafo de proveniência cobre dataset→coluna→property→object; 100% dos outputs produtivos apontam para inputs (T5.1) |
| US 9,348,879 | Provenance | Rastrear derivação em cadeias longas sem perda | Traversal upstream/downstream ilimitado em profundidade via recursive CTE; teste com cadeia de 10+ derivações |
| US20140114907 | Provenance | Reconstruir "de onde veio este valor" sob demanda | `getProvenance` em nível de property: cada property de objeto responde coluna+versão+evento de origem |
| US20150012477 | Data Lineage | Lineage como cidadão de primeira classe, consultável | Lineage API v2: query por nó (dataset/coluna/objeto/property) com upstream/downstream simétricos (T5.1) |
| US 10,027,551 | Lineage | Completude do lineage como propriedade verificável | Job de verificação: qualquer output sem aresta de input = falha de CI (T5.1) |

Família: **Classification access / cross-classification (hardening)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,146,960 / US 11,720,713 | Collaborative environments / classification access | Acesso diferenciado por classificação em ambiente compartilhado | Classificação propaga por join (max) ao longo do lineage colunar: coluna output herda a união das classificações das colunas input (T5.2) |
| US 10,915,542 | Contextual sharing constraints | Compartilhamento restrito por contexto (purpose, environment, tenant) | `context` do authorize passa a ser avaliado em todas as regras de compartilhamento; fuzzing cobre combinações de contexto (T5.5) |
| EP4248349 | Electronic data asset access | Controle de acesso a data asset independente de onde ele é servido | Mesma decisão de acesso via Object API, busca, Function output e export — teste de paridade entre superfícies (T5.4) |
| WO2022245989 | Control of user actions/access | Ações do usuário limitadas pelo mesmo modelo que leituras | Action authorizationPolicy reavaliada com classificação propagada; Action sobre objeto reclassificado pode virar deny retroativamente (T5.6) |
| US 12,066,982 | Data-asset sharing | Compartilhar ativo sem vazar além do permitido | Export/compartilhamento externo materializa somente a visão autorizada (grafo redigido) (T5.3) |
| US 12,353,582 | Exploration/access to data assets | Exploração (navegar, expandir, contar) sem inferência indevida | Noninterference em traversal: contagem de vizinhos, expansão de links e facets não revelam nós proibidos (T5.4) |
| US 12,619,785 | Document hierarchy permissions | Permissões herdadas por hierarquia de conteúdo | Property herda classificação do objeto salvo override explícito auditado; teste de override com reason obrigatória |
| US 9,857,960 / US 10,222,965 / US 11,327,641 / US 12,386,496 / US20250328230A1 | Inter-entity collaboration (família e continuations) | Colaboração entre partes com níveis de classificação distintos, convergindo na porção compartilhável | Visões por principal convergem: authorized_view(A) ∩ authorized_view(B) é idêntica para ambos os lados; prepara o terreno para o M7 (replicação cross-ACL) sem construí-la |
| US 10,044,745 | Network-security risk | Sinal de risco de rede/contexto como entrada de decisão | Campo `environment` do context entra na avaliação; denies por contexto anômalo geram evento de risco (estende auth monitoring do M4) |

Família: **Redaction & permission propagation para modelos (hardening)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20240403396A1 | Permission propagation para outputs de LLMs | Output de modelo não pode "lavar" classificação dos inputs | Todo output de Function/LLM recebe policy_tags = união dos policy_tags dos inputs; lineage registra model output como nó (T5.7) |
| US20150188715 *(faceta redactable; núcleo auditável no M4)* | Verifiable Redactable Audit Log | Audit redigível para compartilhamento sem quebrar verificabilidade | Export de audit para terceiro omite campos sensíveis mantendo a cadeia de hash verificável sobre os campos retidos (T5.8) |

#### O que construir

**Lineage colunar.** Nova tabela `column_lineage_edges { output_dataset_version,
output_column, input_dataset_version, input_column, transformation_id }`. As arestas vêm
de **declaração explícita no TransformationDef** (campo `columnMap` obrigatório a partir
deste marco) validada contra o plano de execução do DuckDB — não tentamos inferir lineage
de SQL arbitrário; declaração + validação é honesta e testável. A granularidade passa a
cobrir a escala completa da blueprint: dataset → table → **column** → record quando
necessário → object → **property** → action → **model output**.

**Propagação de classificação completa.** `classification_labels` por coluna; a
classificação de uma coluna output = união (join pelo lattice de classificações) das
colunas input. Propagação atravessa a fronteira dataset→objeto: property de objeto herda
a classificação da coluna que a alimenta. **Incluindo outputs de LLM/Functions**
(US20240403396A1): todo model output ou function result recebe
`policy_tags = ∪ policy_tags(inputs)` e entra no grafo de lineage como nó — LLM(DATA A)
→ MODEL OUTPUT preserva restrições, na forma literal da blueprint.

**Redaction com reparo de arestas.** O pipeline da blueprint implementado sobre
`traverseLinks`: grafo completo → policy evaluation → remove unauthorized nodes → remove
unauthorized properties → **repair dangling edges** → sanitized graph. O reparo é
transitivo: se B é proibido em A→B→C e A e C são permitidos, o grafo sanitizado expõe a
conexão derivada A→C marcada como `via_redacted` (sem revelar B), ou omite — decisão por
LinkType, declarada no registry. Export/compartilhamento externo materializa somente o
grafo sanitizado.

**Noninterference total.** Respostas indistinguíveis por canal: (1) quantidade de
resultados — listagens e counts já filtram, agora com prova; (2) erro diferente — 403 e
404 padronizados para "não encontrado" fora do escopo autorizado; (3) autocomplete — só
sugere valores de objetos autorizados; (4) search index — busca F9-lite revalidada;
(5) embeddings — sem embeddings nesta fase, mas a regra fica registrada para o M8
(pgvector: namespace por classificação); (6) cache — chaves de cache incluem hash do
principal; (7) LLM — coberto pela propagação acima, exercitado de fato no M8; (8) logs —
policy_tags e valores de properties classificadas nunca entram em log.

**Authorization fuzzing.** Gerador property-based (fast-check) produzindo combinações
`principal × resource × action × context` e comparando cada decisão contra uma matriz
oracle derivada das policy_rules — divergência = bug. Roda em CI com seed fixa +
exploração noturna com seeds aleatórias.

**Tamper detection avançado.** Verificação periódica agendada da cadeia de hash do
audit_log (job pg-boss) + **anchor externo**: a cada N entradas, o hash de checkpoint é
assinado e publicado fora do banco (arquivo no MinIO em bucket separado com lock de
objeto) — adulteração retroativa exige comprometer dois sistemas.

#### Com o quê (stack)

Postgres 16 (`column_lineage_edges`, `classification_labels`, triggers append-only) ·
plano de execução do DuckDB (`EXPLAIN`) para validar o columnMap declarado · recursive
CTE para traversal e reparo de arestas · fast-check (property-based testing) para o
fuzzing · pg-boss para verificação periódica da cadeia · MinIO com object lock para os
anchors · pino com redaction paths para logs · Vitest + Testcontainers.

#### Contratos congelados neste marco

Congela: **Lineage API v2** (colunar: ColumnRef, ColumnEdge, upstream/downstream por nó
de qualquer granularidade) — v1 permanece intocada; v2 é pasta nova com ADR. Nenhum
outro contrato muda: Decision.partial, authorize e ActionEngine já suportam o necessário
desde o M4 — o hardening é de implementação e invariantes, não de interface. Isso é
deliberado: se o hardening exigisse mudar contratos, os contratos estavam errados.

#### Testes obrigatórios

F4 hardening (renumerados, preservados da blueprint): **T5.1** lineage completeness —
100% dos outputs produtivos (datasets, colunas, objetos, properties, model outputs)
apontam para seus inputs; verificação contínua em CI · **T5.2** propagação de
classificação: transform de coluna confidencial → output confidencial; nenhum caminho
declarado perde classificação · **T5.3** redaction: grafo sanitizado sem nós/properties
proibidos, arestas reparadas, export só com visão autorizada · **T5.4** noninterference —
suite dos 8 canais da blueprint (quantidade de resultados, erro diferente, autocomplete,
search index, embeddings, cache, LLM, logs); canais sem superfície ainda (embeddings,
LLM) documentados como regra para M8 · **T5.5** authorization fuzzing — N combinações
principal×resource×action×context sem divergência da matriz oracle · **T5.6** security
matrix estendida: toda API × classificações propagadas × contextos (purpose/environment)
· **T5.7** output de Function herda policy_tags dos inputs e entra no lineage como nó ·
**T5.8** tamper detection: adulteração de audit detectada pela cadeia; verificação de
anchor externo falha se o checkpoint assinado não bate · **T5.9** reavaliação retroativa:
objeto reclassificado muda decisões de Action subsequentes.
**Gate de saída (F4 completa):** security matrix 100% verde incluindo partial; fuzzing
sem violação em execução noturna; lineage completeness colunar em 100%; nenhum componente
(F5–F10, quando existirem) lê storage ignorando o policy layer — reafirmado como
invariante permanente da plataforma.

#### Tasks para o Cursor

106. Contratos Lineage API v2 (colunar) em `packages/contracts/v2` + ADR + golden fixtures.
107. Migration: `column_lineage_edges`, `classification_labels`, `model_output_lineage` — revisar linha a linha.
108. TransformationDef ganha `columnMap` obrigatório; validação contra `EXPLAIN` do DuckDB + testes.
109. Propagação colunar: classificação do output = união (lattice join) das classificações input (T5.2).
110. Propagação dataset→objeto: property herda classificação da coluna de origem; override exige reason auditada.
111. Propagação para model outputs: Function results recebem `∪ policy_tags(inputs)` + nó no lineage (T5.7).
112. Job de lineage completeness: 100% outputs→inputs em todas as granularidades; falha = CI vermelho (T5.1).
113. Redaction engine: remoção de nós/properties não autorizados do ObjectGraph em traverseLinks/export (T5.3 parcial).
114. Reparo de arestas dangling: conexão transitiva `via_redacted` ou omissão por LinkType (T5.3).
115. Respostas indistinguíveis: padronizar 404/403, suprimir counts fora do escopo, autocomplete filtrado (T5.4 parcial).
116. Cache por principal + redaction de policy_tags/valores classificados nos logs (pino redact) (T5.4 parcial).
117. Authorization fuzzing com fast-check: gerador principal×resource×action×context vs. matriz oracle + CI com seed fixa (T5.5).
118. Tamper detection avançado: job de verificação da cadeia + anchor assinado no MinIO com object lock (T5.8).
119. Security matrix estendida: classificações propagadas × contextos × todas as APIs (T5.6) + reavaliação retroativa de Actions (T5.9).
120. Suite noninterference completa (8 canais; regras documentadas para embeddings/LLM no M8) + `docs/arch/security.md` + verificação do gate F4 completo.

---

# PARTE C — MARCOS M6–M9: ESCALA DE ACESSO, DISTRIBUIÇÃO, AIP, CLOSED-LOOP

### M6 — ESCALA DE ACESSO (cobre F9 completa + F1 avançado — federation e edge/SCADA — da blueprint original · Release R6)

**Por que nesta posição:** a F9-lite (busca de objetos permission-aware) já existe desde o M4; o que falta é search **em escala** — e escala só se prova com volume real de objetos, links e usuários, que agora existem depois de M3–M5. A segunda metade do marco é o F1 avançado: federation/pushdown e edge/SCADA, deliberadamente adiados desde o M1 porque só se pagam com uma fonte real que não pode ser copiada (grande demais ou sensível demais) e com demanda real de mundo físico. A blueprint original já revelava essa dependência sem declará-la: o query planner da F9 inclui "Federation" como backend — os dois domínios convergem naturalmente aqui, sob a mesma Query API.

**Erros corrigidos aqui:** **E7** (gates mínimos por release: a R6 fecha com duas UIs sobre a mesma Ontology, não com "F9 completa de papel") e a **dependência oculta F9→F1** (federation planner reaparece como backend do query planner — tratada como um único componente de roteamento). NL query é explicitamente **recortada para o M8**: "natural language" na F9 original pressupõe LLM, que só existe como consumidor autorizado da plataforma no AIP.

#### Patentes → problema técnico → invariante

Família: **Search Around (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,031,981 | Search Around | A partir de um objeto, buscar o que está "em volta" (links, vizinhança) sem nova query manual | `traverseLinks` integrado à Query API: search hit expande para vizinhança autorizada em 1 chamada; traversal respeita ACL por aresta (T6.1) |
| US 9,798,768 | Search Around | Exploração iterativa de grafo a partir de resultados de busca | Pattern query (objeto + linkType + filtro) executada no backend de grafo; resultado sempre sub-conjunto do autorizado (T6.2) |

Família: **Large-scale investigation (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,799,240 | Large-scale investigation | Investigações sobre milhões de objetos sem degradação | Suite de volume: 1M/10M/100M objetos indexados com p95 medido por tipo de query (T6.7/T6.8) |
| US 9,201,159 | Large-scale investigation | Conjuntos de trabalho grandes e compartilháveis | Result sets paginados por cursor estável, sem skip/limit profundo (T6.6) |
| US 9,639,578 | Large-scale investigation | Análise sobre coleções com filtragem progressiva | Filter chains declarativas: sequência de filtros aplicada no planner, não na UI (T6.12) |
| US 9,852,144 | Large-scale investigation | Seleção/refino de subconjuntos em escala | Refinamento é nova avaliação do planner sobre o conjunto filtrado — nunca filtro client-side sobre página |
| US 10,423,582 | Large-scale investigation | Operações investigativas com trilha auditável | Toda query operacional emite trace com principal, planner decision e backend usado (T0.5 estendido) |

Família: **Search (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,868,537 | Search | Busca unificada sobre dados heterogêneos | Query API única sobre Object Store + Search Index + Graph + Federation; o planner escolhe o backend (T6.13) |
| US 9,262,529 | Simple web search | Experiência de busca simples sobre modelo complexo | Caixa única de busca na UI resolve tipo, texto e filtro sem o usuário conhecer o schema |
| US 10,726,032 | Search templates | Buscas parametrizadas e reutilizáveis por perfil operacional | Search templates versionados (nome, parâmetros, filter chain, policy de visibilidade) consumíveis por qualquer app |
| US 9,619,557 | Key-phrase characterization | Frases-chave extraídas do conteúdo para indexação | Index pipeline extrai keywords/labels por ObjectType declarados no mapping; relevância medida em golden queries (T6.3) |

Família: **Filter chains (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,041,714 | Filter chains | Composição de filtros como objeto de primeira classe | Filter chain é dado versionado (AST de filtros), serializável e testável isoladamente |
| US 8,280,880 | Filter chains | Aplicação consistente de filtros em qualquer consumidor | A mesma chain produz o mesmo conjunto em UI, API e export — teste de paridade cross-canal (T6.12) |

Família: **Natural language (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 11,238,102 | Natural language | Consulta em linguagem natural sobre dados estruturados | **Recortada para o M8:** NL query é um caso de LLM read-only sobre a Ontology (Degrau 1); o teste original "NL query grounding" da F9 é executado como T8.x no M8 |

Família: **Data-management visualization (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,639,580 | Data-management visualization | Visualização de grandes volumes gerenciáveis | Visão grafo da R6 renderiza subgrafo paginado por traversal autorizada; nunca dump integral no cliente |

Família: **Mobile (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,727,376 | Mobile — tasks | Trabalho operacional fora do desktop | API-first: nenhuma lógica nas UIs web; um cliente mobile futuro consome os mesmos contratos |
| US 10,037,314 / US 10,997,363 / US 11,494,549 | Mobile — reports | Relatórios operacionais consumidos em campo | Export/relatório materializa somente a visão autorizada (redaction do M5 reutilizada) |
| US 9,380,431 | Mobile — teams | Colaboração entre equipes sobre os mesmos objetos | Identidade e grupos (M0/M4) como base; compartilhamento de objetos/links passa por authorize |
| (teste original "mobile offline") | — | Uso desconectado em campo | **Re-atribuído ao M7** (T7.12): offline de verdade exige snapshot autorizado local + reconciliation, que é F5 |

Família: **Geospatial (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,270,727 | Geospatial | Consultas geográficas sobre objetos | Campos geo indexados (Meilisearch geo + PostGIS); **condicional**: só entra se o caso de uso tiver dimensão geográfica |
| US 8,085,268 | Geodetic polygon | Consulta por polígono geodésico | Filtro `withinPolygon` no filter chain — idem condicional |
| US 9,041,708 | Viewsheds | Análise de visada | Fora de escopo de backend; registrado como analytics especializado (abaixo) |

Família: **Specialized analytics — úteis somente quando exigidos (F9)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,484,115 / US 9,378,524 | Time-series | Série temporal sobre propriedades de objetos | Não vira core: vira Function sobre objetos quando houver caso; nenhuma infra dedicada na R6 |
| US 8,034,971 / US 8,326,727 | Dynamic date sets | Conjuntos definidos por janelas temporais dinâmicas | Filtro temporal é parâmetro de filter chain, não engine novo |
| US 8,484,549 / US 9,727,981 | Sensitivity analysis | Análise de sensibilidade de decisões | Domínio de Function (M4), não de search; sem construção neste marco |

Família: **Federation (F1 avançado)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,402,397 | Federation | Consultar fonte remota sem ingestá-la | Federation planner decompõe query em pushdown por fonte; resultado federado passa pelo mesmo authorize (T1.5, executado aqui como T6.10) |
| US 11,281,659 | Federation | Representação temporária de dados federados como objetos da plataforma | Temporary representation: resultado do pushdown vira objetos efêmeros com TTL, provenance `federated` e sem persistência no store imutável |
| US 11,681,690 | Federation | Materialização opcional e controlada | Materialização de resultado federado é decisão explícita e auditada (quem, por quê, com qual policy); nunca efeito colateral de uma query |

Família: **Edge / mundo físico (F1 avançado)**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 11,799,877 | SCADA | Integração com sistemas de controle industrial | **Condicional a fonte real:** connector SCADA/OPC-UA implementado via Connector SDK, sem tocar o core — gate da F1 reutilizado como prova |
| US 12,261,861 | SCADA (continuação) | Comandos/telemetria industriais com segurança | Telemetria entra como CanonicalEvent; qualquer comando de volta é Action com write-back pelo connector — nenhum caminho novo |
| US20250233873A1 | SCADA (continuação) | Evolução da integração edge | Mesma invariante: edge é connector, não camada |

#### O que construir

**Query API + Ontology Query Planner multi-backend.** A blueprint é explícita: não fazer
`UI → SQL`. Fazer `UI → Query API → Ontology Query Planner`, com quatro backends:
Object Store (Postgres — filtros estruturados por tipo/property), Search Index
(Meilisearch — full-text, autocomplete, facets), Graph (recursive CTE — traversal e
pattern query) e Federation (pushdown — quando habilitado). O planner recebe uma
`ObjectQuery` estendida (texto livre? filtros estruturados? traversal? geo?) e decide o
backend por regra determinística e inspecionável: toda decisão de roteamento é logada
com motivo. Queries híbridas (texto + filtro estruturado) executam no índice com
pós-filtro no Object Store; o planner nunca varre o índice para responder filtro puro
estruturado.

**Índice permission-aware (o coração do marco).** O Meilisearch entra na stack agora.
Documento indexado: `object_id, object_type, ontology_version, properties_indexadas
(declaradas no mapping — nunca "tudo"), labels, keywords, acl_principals/grupos
(materializados a partir das policy_rules), policy_tags, timestamps, geo (opcional)`.
O problema que a blueprint nomeia: *search pode revelar algo que a Object API
bloquearia*. O security model atinge **seis superfícies**, e cada uma vira teste:
(1) **search hit** — filtro obrigatório por ACL no índice + pós-verificação
`authorize()` por hit antes de retornar; (2) **autocomplete** — sugere somente valores
de documentos autorizados (filtro idêntico ao da busca); (3) **facet count** — contagens
computadas **depois** do filtro de ACL (contagem pré-filtro vazaria existência — é o
"usuário sem permissão não vê nem o count" da R4, agora no índice); (4) **suggestion** —
mesma regra do autocomplete; (5) **snippet** — gerado somente de campos que o principal
pode ler (Decision.partial do M4: campo `partial` não entra no snippet, nem redigido —
simplesmente ausente); (6) **ranking** — score calculado sobre o conjunto filtrado; um
objeto proibido não pode influenciar a ordem dos permitidos.

**Index pipeline com freshness verificável.** Projeção `objects → documentos` via outbox
(o event bus do M0): mutação de objeto → job pg-boss → upsert no Meilisearch com
`index_version = object_version`. Freshness monitor: lag entre última mutação e último
upsert exposto em métrica; leitura com `min_freshness` opcional falha explícita se o
índice está atrasado (stale index nunca responde como se estivesse fresco).

**Filter chains e search templates.** Filtro é AST versionado (`field, op, value, and/or`),
componível em chains nomeadas; search template = chain + parâmetros + policy de
visibilidade. Ambos vivem no Postgres e são consumidos por qualquer app — é a resposta
concreta a "aplicativos não guardam cópia própria da lógica".

**Aplicações operacionais: duas UIs, zero lógica duplicada.** A R6 entrega a app
operacional: **UI 1 — Object Explorer** (busca, filtros, detalhe de objeto com
provenance, ações disponíveis via `getAvailableActions`); **UI 2 — Visão Grafo**
(subgrafo por traversal, expansão de nós, mesma busca no topo). As duas consomem
exclusivamente Ontology/Action/Function/Search APIs; o gate da F9 é literal: se alguma
regra de negócio (formatação semântica, decisão de permissão, cálculo) existe em uma UI
e não na API, o gate falha. Estratégia: package `apps/web/lib` contém apenas apresentação;
tudo que duas UIs precisam sobe para a API.

**Federation (somente se houver fonte real que justifique).** Fluxo da blueprint:
`user query → federation planner → pushdown query → source system → temporary
representation → optional materialization`. Implementação: conectores que optam por
federation implementam `federatedQuery(pushdownSpec)` (extensão do Connector, v2); o
resultado vira **objetos efêmeros** marcados `provenance: federated`, com TTL de sessão,
fora do store imutável — e passam pelo mesmo `authorize()` com os `policy_tags` da fonte.
Materialização (copiar para o store) é uma Action explícita com reason auditada. "Não
copie 5 TB para responder uma pergunta de 200 linhas."

**Edge/SCADA (somente se houver fonte real).** Nada de camada nova: um connector
SCADA/OPC-UA via Connector SDK, provando pela segunda vez o gate da F1 — conectar fonte
completamente nova sem alterar o core. Telemetria entra como CanonicalEvent; comando de
volta é Action com write-back. Se não houver fonte real, este item fica documentado como
ADR "não construir sem demanda" — vertical específica não vira core.

**Geoespacial (condicional).** Se o domínio exigir: campos geo no documento do índice
(Meilisearch geo) + `withinPolygon` via PostGIS no Object Store como filter de chain.
Sem caso real, fica fora.

#### Com o quê (stack)

**Meilisearch** (novo na stack, exatamente onde o roadmap o prometeu: M6/R6) — binário
único, índice permission-aware = ACL no documento + filtros; upgrade nomeado:
Elasticsearch/OpenSearch · **Postgres 16** recursive CTE como backend Graph (2–4 hops
com folga; Neo4j continua sendo upgrade nomeado, não necessidade) · **PostGIS** somente
se geo entrar · **pg-boss + outbox** no index pipeline (mesma semântica exactly-once
lógica do M0) · **Fastify + Zod** para a Query API (Zod gera o schema do planner) ·
**Next.js + shadcn/ui + TanStack Query** nas duas UIs · **DuckDB** como motor de
pushdown para fontes SQL/arquivos na federation · **k6** para os testes de p95 (ferramenta
de teste, não stack de runtime) · Vitest + Testcontainers (Meilisearch real em container
nos testes de leakage).

#### Contratos congelados neste marco

Congelam: **Search API** (`search(query, filterChain?, principal) → hits autorizados +
facets filtradas + snippets seguros`; `autocomplete`; `templates`) e **Object Query API**
(o `ObjectQuery` unificado que o planner consome — entra em `packages/contracts/v2` com
ADR, pois estende o v1 com texto livre, geo e `min_freshness`). **Connector v2**
(`federatedQuery` + `writeBack` já existente) congela **somente se** a federation for
ativada com fonte real — caso contrário o tipo fica definido e marcado experimental.
Nenhum contrato existente muda: a prova de que ObjectService/ActionEngine foram bem
desenhados é que search e federation em escala são consumidores, não modificadores.

#### Testes obrigatórios

F9 (renumerados, preservados da blueprint): **T6.1** graph traversal — traversal
multi-hop autorizada, sem aresta proibida · **T6.2** pattern query — objeto+linkType+
filtro resolvido no backend de grafo · **T6.3** search relevance — golden queries com
ordenação esperada · **T6.4** index freshness — mutação propaga para o índice dentro do
SLO; métrica de lag · **T6.5** permission leakage — suite das 6 superfícies (hit,
autocomplete, facet count, suggestion, snippet, ranking): principal sem acesso não
detecta existência por nenhum canal · **T6.6** pagination — cursor estável sob mutação
concorrente · **T6.7** volume — 1M/10M objetos (100M documentado como projeção/carga
sintética se o hardware não comportar) · **T6.8** p95 latency — orçamento por tipo de
query medido com k6, regressão = CI vermelho · **T6.9** stale index — leitura com
`min_freshness` falha explícita; nunca resposta silenciosamente velha · **T6.10 =
T1.5 (federation)** — consultar registro remoto sem copiá-lo definitivamente: objeto
efêmero federado, TTL, authorize aplicado, materialização apenas via Action auditada ·
**T6.11** planner routing — cada perfil de query cai no backend esperado; decisão logada ·
**T6.12** filter chain parity — mesma chain, mesmo conjunto em UI/API/export ·
**T6.13** query unificada — uma Query API sobre os 4 backends.
Re-atribuídos: **mobile offline → M7 (T7.12)**; **NL query grounding → M8 (T8.14)**.
Novos (erros corrigidos): **T6.14** mutação de ACL reflete no índice (revogação remove
o hit na próxima query) · **T6.15** objeto `partial` aparece com snippet sem campos
redigidos.
**Gate de saída (F9):** duas interfaces completamente diferentes sobre a mesma Ontology
**sem uma linha de lógica de negócio duplicada** — verificado por revisão + por teste de
paridade comportamental entre as UIs; e busca não vaza objeto proibido em nenhuma das 6
superfícies, sob volume de 10M.

#### Tasks para o Cursor

121. Contratos Search API + Object Query API v2 em `packages/contracts/v2` + ADR + golden fixtures.
122. Migration: `search_templates`, `filter_chains`, `index_checkpoints` — revisar linha a linha.
123. Meilisearch no compose + cliente tipado + ADR "índice permission-aware = ACL no documento".
124. Index projector: outbox de mutações de objects → upsert no Meilisearch com `index_version=object_version`.
125. ACL materializada no documento: derivação de `acl_principals/grupos` das policy_rules + reindexação na mudança de policy (T6.14).
126. Busca com filtro obrigatório de ACL + pós-verificação authorize por hit (T6.5, superfície 1).
127. Snippets seguros: geração somente de campos autorizados, integrando Decision.partial (T6.15).
128. Facets/counts/autocomplete/suggestion pós-filtro de ACL (T6.5, superfícies 2–4).
129. Ranking sobre conjunto filtrado + golden queries de relevância (T6.3, T6.5 superfície 6).
130. Query planner multi-backend: regras de roteamento determinísticas + log de decisão (T6.11/T6.13).
131. Backend Graph: pattern query e traversal via recursive CTE com ACL por aresta (T6.1/T6.2).
132. Paginação por cursor estável sob mutação concorrente (T6.6).
133. Filter chains como AST versionado + paridade UI/API/export (T6.12).
134. Search templates versionados consumidos pela API + CRUD.
135. Freshness monitor: lag outbox→índice, `min_freshness` na query, teste de stale index (T6.4/T6.9).
136. Harness de carga: seeds de 1M/10M objetos + k6 com orçamento de p95 por tipo de query (T6.7/T6.8).
137. UI 1 — Object Explorer (busca, filtros, detalhe com provenance, ações) só sobre as APIs.
138. UI 2 — Visão Grafo sobre as mesmas APIs + verificação do gate "zero lógica duplicada".
139. Federation (condicional): Connector v2 `federatedQuery`, planner pushdown via DuckDB, objetos efêmeros com TTL + authorize (T6.10/T1.5).
140. Materialização federada como Action auditada + ADR edge/SCADA ("construir só com fonte real") + `docs/arch/search.md` + gate R6.

### M7 — DISTRIBUIÇÃO (cobre F5 inteira da blueprint original · track dedicada, pós-R6)

**Por que nesta posição:** este marco é a correção **E1** — o maior erro de ordem da
blueprint original. A F5 estava na posição 5, entre Security e Entity Resolution, mas o
protocolo que ela mesma descreve replica `mutation_id`, `object`, `operation`, `policy` —
ou seja, **mutações de objetos da Ontology (F7) e Actions (F8)**, não dataset versions.
As patentes que a F5 cita confirmam: *Cross-Ontology* (US 9,330,157), *redacted graph
collaboration* (US 9,501,761), *disconnected investigations* — tudo sobre grafos de
objetos e colaboração operacional, não sobre dados brutos. Construir replicação na
posição original significaria projetar o protocolo contra a abstração errada (dataset
versions) e reescrevê-lo quando objetos com resolução semântica de conflito existissem.
Além disso, nenhum domínio F6–F10 depende de replicação: ela é **produto avançado**
(cenário multi-org, desconectado, campo), não fundação. Agora — e só agora — existe o
que replicar: objetos com policy, histórico e provenance, e Actions com trilha de
decisão. O protocolo é projetado **uma única vez, contra a abstração certa**.

**Erros corrigidos aqui:** **E1** (integral). Este marco é uma **track dedicada**:
só entra no cronograma quando houver cenário real de multi-site/offline (decisão #2 da
Parte 8 do roadmap); até lá, permanece especificado mas não construído.

#### Patentes → problema técnico → invariante

Família: **Incremental replication**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,886,601 | Incremental replication | Sincronizar réplicas enviando somente o que mudou | Vector checkpoint por réplica; o sistema calcula a diferença e envia somente os eventos necessários (T7.3) |
| US 9,785,694 | Incremental replication | Eficiência de sincronização incremental em escala | Anti-entropy por diff de vetores, nunca full-sync; custo de sync proporcional ao delta, não ao estado (T7.10) |

Família: **Cross-Ontology**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,330,157 | Cross-Ontology replication | Replicar entre ontologies/instâncias com schemas diferentes | Mutations carregam `ontology_version`; réplica com versão divergente aplica migration declarativa ou recusa com erro explícito — nunca aplica torto (T7.11) |
| US 10,061,828 | Cross-Ontology | Mapeamento entre modelos de instâncias distintas | Replication scope declarativo: quais ObjectTypes/LinkTypes entram no escopo compartilhado entre duas instâncias |

Família: **Cross-ACL**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,527,461 | Cross-ACL | Sincronizar dados entre domínios com ACLs diferentes | Evento replicado carrega `policy`; a réplica destino avalia contra suas próprias policy_rules antes de aplicar (T7.5) |
| US 8,782,004 | Cross-ACL | Convergir recebendo mudança parcialmente redigida | **O problema crítico da blueprint:** réplica B sem permissão sobre parte do evento converge mesmo assim — campos denied chegam como tombstone redigido (presença conhecida, conteúdo oculto) e o estado autorizado converge (T7.5 + invariante) |
| US 9,715,518 | Cross-ACL | Aplicação parcial sem violar segurança | Mutation parcialmente aplicável: campos autorizados aplicam, denied ficam pendentes de elevação de ACL — e convergem quando a ACL muda (T7.6) |
| US 10,089,345 | Cross-ACL | Consistência entre domínios administrativos distintos | Porção compartilhável entre réplicas é computável (`shared_scope(A,B)`); o invariante de convergência é afirmado **sobre ela**, não sobre o estado total |

Família: **Secure replication**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 10,621,198 | Secure replication | Canal de replicação autenticado e íntegro | Réplicas têm identidade própria (service principal do M0); mutations assinadas; TLS mútuo; mutation adulterada é rejeitada e alertada (T7.13) |

Família: **ACL replication changes**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,838,538 | ACL replication changes | Mudança de ACL é ela mesma um evento replicado e ordenado | Policy change entra no log de mutations com logical clock — ordenada em relação às mutations de dados que ela afeta; **mudança de ACL durante partição** converge corretamente na reconciliação (T7.6) |

Família: **Conflict/deconfliction**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,515,912 | Deconfliction | Edições simultâneas em réplicas distintas | Conflict detector compara logical clocks e dependencies; estratégia de resolução declarada por ObjectType/property — nunca "último escritor vence" global silencioso (T7.7) |
| US 9,569,070 | Deconfliction | Resolução registrada e revisável | Todo conflito gera `conflict_record` (valores concorrentes, estratégia aplicada, resultado); resolução humana é Action e entra no audit (T7.8) |

Família: **Disconnected investigations**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 8,364,642 | Disconnected operations | Trabalhar desconectado sem perder segurança nem história | Offline flow da blueprint: snapshot autorizado local → disconnect → mutações locais → reconnect → detector → resolução → estado convergido (T7.9) |
| US 8,812,444 | Disconnected investigations | Snapshot local do que o usuário pode ver | **Local authorized snapshot:** o dispositivo recebe somente a visão autorizada do principal (redaction do M5 reutilizada) — offline não é backdoor de acesso (T7.12) |
| US 9,275,069 | Disconnected investigations | Reintegração de trabalho feito offline | Mutações offline voltam como mutations assinadas com logical clock local; entram no mesmo pipeline de detecção de conflito — não há caminho privilegiado de "reintegração direta" |

Família: **Redacted graph collaboration**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 9,501,761 | Redacted graph collaboration | Colaborar sobre um grafo do qual cada parte vê uma fatia | O grafo replicado entre domínios é o grafo sanitizado (redaction com reparo de arestas do M5); colaboração cross-org nunca expõe nó proibido, nem por aresta dangling (T7.14) |

#### O que construir

**Replication protocol — o objeto de mutação.** Toda mudança replicável é uma mutation
com os campos exatos da blueprint: `mutation_id, source_replica, logical_clock, object,
operation, payload, policy, timestamp, dependencies`. Fonte das mutations: o log do
Action engine (M4) e do Object projector (M3) — **objetos e actions, não dataset
versions** (E1). `logical_clock` é relógio de Lamport por réplica; `dependencies` lista
os mutation_ids causais conhecidos, permitindo aplicar fora de ordem sem violar
causalidade.

**Vector checkpoints e sync incremental.** Cada réplica mantém um vetor
`{replica_id → logical_clock}` do que já viu de cada origem. Sync: Réplica A informa seu
vetor; B calcula o diff e envia somente os eventos necessários. Anti-entropy periódico
(job) garante convergência mesmo com eventos perdidos; custo proporcional ao delta.

**Cross-ACL: convergir com eventos parcialmente redigidos.** O problema crítico que a
blueprint nomeia: a Réplica B pode não ter permissão para visualizar parte do evento, e
mesmo assim precisa convergir. Implementação: ao exportar mutations para um domínio com
ACL distinta, o exportador aplica o `shared_scope(A,B)` — campos fora do escopo chegam
como **tombstones redigidos** (`field_present: true, value: null, redacted: true`).
A réplica destino: (1) aplica os campos autorizados; (2) registra os tombstones como
pendências; (3) quando uma mudança de ACL posteriormente autoriza o campo, a pendência é
resolvida por re-sync pontual. **O estado que converge é o estado autorizado** — é isso
que o invariante afirma.

**Mudança de ACL como mutation.** Policy changes entram no mesmo log, com logical clock,
ordenadas em relação às mutations de dados. Mudança de ACL durante partição é o caso de
teste mais importante da fase (T7.6): ao reconciliar, a ordem causal decide quais
mutations eram visíveis quando.

**Offline — o fluxo da blueprint, literal.** `ONLINE STATE → local authorized snapshot →
DISCONNECT → local mutations → RECONNECT → conflict detector → resolution → new
converged state`. O snapshot local é materializado a partir da visão autorizada (grafo
sanitizado do M5); mutações locais ficam em fila assinada no dispositivo; no reconnect,
entram no pipeline normal. Este é também o destino do teste "mobile offline" da F9.

**Conflict detection/resolution.** Detector: duas mutations para o mesmo
`(object, property)` sem relação causal = conflito. Resolução **declarada por
ObjectType/property**: last-writer-wins por logical clock (campos voláteis), merge de
conjuntos (links, tags), ou escalação humana (campos críticos — vira tarefa de revisão
na fila do M3). Toda resolução gera `conflict_record` auditável; resolução humana é
Action, com o mesmo pipeline authorize→validate→tx→audit.

**Topologia.** Hub-and-spoke mínimo: N réplicas spoke sincronizam com um hub; spoke↔spoke
direto é extensão posterior. Testes com 3+ réplicas obrigatórios desde o início — 2
réplicas escondem classes inteiras de bugs de ordenação.

#### Com o quê (stack)

Postgres 16 (`mutation_log` append-only, `replica_vectors`, `conflict_records`,
`redacted_pendings` — o mesmo banco, novas tabelas) · outbox/LISTEN/NOTIFY para sync
intra-cluster; transporte inter-site via HTTPS com mTLS e mutations assinadas (ed25519 —
service principals do M0) · pg-boss para anti-entropy e re-sync · Testcontainers
orquestrando **3 instâncias do modular monolith** nos testes de partição (toxiproxy no
compose de teste para network partition/reorder/drop) · fast-check para gerar
interleavings adversariais de mutations · o redaction engine e a fila de revisão já
construídos (M5/M3) — **reutilizados, não reconstruídos**: este marco é o exemplo
canônico de "engines generalizam quando um consumidor real exige".

#### Contratos congelados neste marco

Congela: **Replication API** (`exportMutations(since: VectorClock, scope) → MutationBatch`,
`importMutations(batch) → ImportResult`, `getVector()`, `resolveConflict(id, decision)`)
— contrato novo em `contracts/v2`, único deste marco. Tipos definidos já, congelados no
fim do marco: `Mutation`, `VectorClock`, `ConflictRecord`. Nenhum contrato existente
muda — e isso é uma propriedade a verificar: se replicar objetos/actions exigir mudar
ActionEngine ou ObjectService, algo estava errado no M3/M4.

#### Testes obrigatórios

F5 (renumerados, **todos preservados da blueprint**): **T7.1** network partition —
partir 3 réplicas, mutar em ambos os lados, reconectar, convergir · **T7.2** reordered
events — entrega fora de ordem respeitando causalidade via dependencies · **T7.3**
duplicated events — mutation_id idempotente: aplicar 2× = aplicar 1× · **T7.4** dropped
events — anti-entropy detecta lacuna no vetor e recupera · **T7.5** denied fields —
evento parcialmente redigido converge: campos autorizados aplicam, tombstones pendentes ·
**T7.6** change de ACL durante partition — policy change ordenada no log; reconciliação
resolve pendências redigidas corretamente · **T7.7** simultaneous edits — detector flaga;
estratégia declarada por property aplica · **T7.8** resolution auditável — conflict_record
completo; resolução humana via Action · **T7.9** offline mutation + reconciliation —
fluxo de 7 estágios da blueprint ponta a ponta · **T7.10** 3+ replicas — interleavings
gerados por fast-check, convergência em todas as ordens · **T7.11** ontology versions
divergentes entre réplicas — migration ou recusa explícita · **T7.12** mobile offline
(re-atribuído da F9) — snapshot autorizado local: dispositivo desconectado nunca vê além
da ACL · **T7.13** mutation adulterada em trânsito — rejeitada pela assinatura ·
**T7.14** grafo cross-org sanitizado — redaction + reparo de arestas aplicados à exportação.
**Invariante de convergência (teste central):** quando a rede estabilizar,
`authorized_state(replica A) == authorized_state(replica B)` **para a porção de
informação compartilhável entre elas** — verificado por comparação de estado materializado
sob `shared_scope(A,B)` ao fim de todo teste deste marco.
**Gate de saída (F5):** o invariante acima, verde nos 14 testes, com 3 réplicas, sob
partição, com ACL mudando durante a partição e com mutações offline concorrentes.

#### Tasks para o Cursor

141. Contratos Replication API + tipos Mutation/VectorClock/ConflictRecord em `contracts/v2` + ADR "replica objects/actions, não datasets" (E1) + golden fixtures.
142. Migration: `mutation_log` (campos exatos da blueprint), `replica_vectors`, `conflict_records`, `redacted_pendings` — revisar linha a linha.
143. Mutation source: Action engine e Object projector emitem mutations no log (mesma tx do write-back) com logical clock de Lamport.
144. Vector checkpoints: `getVector`, diff de vetores, `exportMutations(since, scope)` incremental (T7.3).
145. `importMutations`: idempotência por mutation_id (T7.3), causalidade por dependencies com buffer de reordenação (T7.2).
146. Anti-entropy job: detecção de lacuna no vetor + re-sync pontual (T7.4).
147. Identidade de réplica: service principal + assinatura ed25519 + verificação na importação (T7.13).
148. Cross-ACL export: `shared_scope(A,B)` + tombstones redigidos + aplicação parcial (T7.5).
149. Policy change como mutation ordenada no log + resolução de pendências redigidas após mudança de ACL (T7.6).
150. Conflict detector: concorrência por (object, property) sem relação causal + `conflict_records`.
151. Estratégias de resolução declaradas por ObjectType/property (LWW por clock, set-merge, escalação humana via fila de revisão) (T7.7/T7.8).
152. Offline: local authorized snapshot (visão sanitizada) + fila local assinada de mutations (T7.12).
153. Reconnect: ingestão de mutations offline no pipeline normal + reconciliação (T7.9).
154. Infra de teste: 3 instâncias + toxiproxy (partition/reorder/drop) + fast-check de interleavings (T7.1/T7.10) + verificador do invariante `authorized_state(A)==authorized_state(B)`.
155. Ontology-version divergence entre réplicas (T7.11) + export de grafo sanitizado cross-org (T7.14) + `docs/arch/replication.md` + gate F5.

### M8 — AIP PROGRESSIVO EM 4 DEGRAUS (cobre F10 completa da blueprint original · Releases R7–R8)

**Por que nesta posição:** AIP é **consumidor** da plataforma, não fundação — cada coisa
que um agente faz (consultar objeto, invocar function, propor action) já existe como
contrato autorizado desde M3–M6. Construir AIP antes disso é criar um chatbot sobre um
banco. A progressão em 4 degraus segue os milestones H–K da própria blueprint original:
**Degrau 1** — LLM read-only sobre a Ontology (R7); **Degrau 2** — agent → function
(R7); **Degrau 3** — agent → proposed action (R8); **Degrau 4** — agent → authorized
action, com humano aprovando (R8). Cada degrau exige o anterior **provado por evals**.
E a regra final, na letra da blueprint: **autonomia sem humano no loop (o milestone L)
NÃO é uma release — é uma decisão de negócio**, que só se toma depois que a R8 roda
meses sem incidente. Nenhuma task deste marco a implementa.

**Erros corrigidos aqui:** nenhum E1–E7 diretamente; aplica-se a regra de ouro (o eval
framework e o Tool Registry nascem no Degrau 1, mínimos, e endurecem quando o degrau
seguinte exige) e as regras de noninterference registradas no M5 para os canais
"embeddings" e "LLM", que agora ganham superfície real.

#### Patentes → problema técnico → invariante

Família: **LLM ↔ Ontology**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US 12,405,983 | LLM ↔ Ontology (ativa, concedida em 2/9/2025) | LLM operando sobre o modelo semântico com grounding em objetos reais | Toda resposta do Degrau 1 cita object_ids recuperados via Search/Ontology API; resposta sem grounding = falha de eval (T8.1) |
| US20250278421A1 | LLM ↔ Ontology (publicação relacionada) | Contexto ontológico estruturado para o modelo | Context builder monta contexto autorizado (identity+permissions+objetos) — nunca dump de tabelas no prompt |
| US20250363154A1 | LLM ↔ Ontology (publicação relacionada) | Interação LLM–modelo semântico versionável | Prompt/context schemas versionados junto com ontology_version; eval compara versões |

Família: **User/Profile AI**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20240419658A1 | Profile-Based AI | Comportamento do assistente condicionado ao perfil do usuário | Context builder inclui role/permissions do principal; dois usuários com ACLs diferentes recebem respostas diferentes sobre o mesmo dado (T8.2) |

Família: **AI UI**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| EP4443310A1 | AI System User Interfaces | UI de interação com sistema de IA | Chat do Degrau 1 é mais uma UI sobre as mesmas APIs — citações clicáveis navegam para o objeto no Object Explorer (gate F9 reutilizado) |

Família: **Agent Evaluation**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20250199932A1 | Agent Evaluation | Avaliar agente sistematicamente, não por impressão | Evaluation framework versionado desde o Degrau 1: nenhum degrau sobe sem eval suite verde (T8.3) |
| EP4571511A1 | Agent Evaluation | Casos de avaliação reproduzíveis | eval_case com input/context/expected/rubric pinados por versão; mesmo eval_case + mesma versão → resultado comparável |

Família: **Agent Ops**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20250110786A1 | Agent Ops | Operar agentes em produção (observar, limitar, desligar) | Todo run de agente é rastreável (trace por state), tem budget (max_iterations, timeout, cost cap) e kill switch por agente/ferramenta (T8.4) |

Família: **State-machine-backed LLM agents**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20250110753A1 | State-machine agents | Agente crítico não improvisa indefinidamente | Máquina de estados fixa (START→…→DONE); cada state tem allowed_tools/prompt/transition_conditions/maximum_iterations; transição inválida é impossível por construção (T8.5) |
| EP4530883 | State-machine agents | Estados e transições auditáveis | AgentRun persiste state a state: entrada, saída, tool calls, decisão de transição — replay inspecionável (T8.6) |

Família: **Model integration**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20240403103A1 | Model integration | Integrar modelos de forma intercambiável | ModelProvider interface: trocar LLM é trocar config, não código — é a base do gate da F10 (T8.7) |

Família: **Model evaluation**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20240420258A1 | Model evaluation | Comparar versões de modelo/prompt objetivamente | Métricas por model_version/prompt_version/agent_version; regressão entre versões bloqueia promoção (T8.8) |

Família: **Permission-aware LLM output**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20240403396A1 | Permission-aware LLM output (também citada na F4) | Output do LLM preserva restrições dos dados que o originaram | Policy filtering na saída: resposta é reavaliada contra as policy_tags dos objetos usados no contexto; vazamento por paráfrase = falha adversarial (T8.9) |

Família: **LLM-assisted error analysis**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20250147832A1 | LLM error analysis | Diagnosticar falhas de pipeline com assistência | Caso de uso interno: Function de diagnóstico lê logs/traces via Tool Registry — read-only, sem credencial nova |
| US 12,487,876 | LLM error analysis | Análise de erro groundada em evidência operacional | Diagnóstico cita trace_id/log específicos; alucinação de causa raiz detectada por eval de groundedness |
| US20260127063A1 | LLM error analysis | Automação da investigação de falhas | Diagnóstico propõe hipóteses, nunca aplica correção: remediação é Action humana |

Família: **LLM + Ontology-assisted ML**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20250384290A1 | LLM + Ontology ML | ML assistido pelo modelo semântico | Features/seleções derivadas de ObjectTypes declarados; lineage de model output (M5) obrigatório |
| EP4668176A1 | LLM + Ontology ML | Pipeline de ML integrado à plataforma | Treino/avaliação consomem DatasetStore/ObjectService — nenhum acesso direto ao storage (invariante F4 reafirmado) |

Família: **Cross-application AI assistant**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20260017123A1 | Cross-app assistant | Assistente consistente atravessando aplicações | O assistente vive no AI Gateway, não nas apps: mesma identidade, mesmas tools, mesmas policies em qualquer UI |

Família: **NL-controlled multidimensional visualizations**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20260065540A1 | NL visualizations | Linguagem natural controlando visualização multidimensional | NL → filter chain/search template (M6), nunca NL → SQL: a visualização resultante herda a ACL da query gerada (T8.14) |

Família: **Few-shot example selection**

| Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
|---|---|---|---|
| US20260127387A1 | Few-shot selection | Selecionar exemplos relevantes para o prompt | Exemplos few-shot recuperados por similaridade (pgvector) **somente de fontes autorizadas** — exemplo nunca vaza dado de outra classificação (T8.10) |
| EP4738182A1 | Few-shot selection | Retrieval de exemplos versionável e auditável | Banco de exemplos versionado com provenance; seleção logada por run |

#### O que construir

**Fundação comum (entra no Degrau 1 e endurece por degrau).**
**AI Gateway** — o fluxo da blueprint: `User → AI Gateway → Identity + Context → Policy →
Agent Runtime → Planner → Tool Registry → Result → Policy filtering → Response`. O
Gateway é o único ponto de entrada de LLM na plataforma; nenhuma app chama modelo
diretamente. **ModelProvider interface** (complete/embed) com dois providers (ex.: um
comercial via API + um local) desde o início — o gate da F10 exige troca real.
**Tool Registry** — LLM não recebe credenciais soltas. Ferramenta: `tool_id,
input_schema (zod), output_schema, required_permission, risk_level, read/write, timeout,
rate_limit` (campos exatos da blueprint). As primeiras tools são **wrappers finos** dos
contratos já congelados: `ontology.queryObjects`, `ontology.getObject`,
`search.search`, `function.invoke` (Degrau 2), `action.propose` (Degrau 3). Invocação de
tool passa por `authorize()` com o principal do usuário — o agente não tem identidade
privilegiada. **Context builder** — `user identity + role + permissions + object context
+ conversation + workflow state + available tools + organizational policies` (campos da
blueprint) → prompt/contexto **autorizado**: o contexto é montado a partir de dados que
passaram pelo policy layer, e `available_tools` já chega filtrado por
required_permission. **"AI nunca é a autoridade"** — regra arquitetural fixa: authority
permanece em Policy Engine, Action Engine, Ontology. O LLM **propõe ou invoca interfaces
autorizadas**; nunca escreve, nunca decide acesso, nunca contorna o pipeline
authorize→validate→tx→write-back→audit. **pgvector entra aqui** (upgrade nomeado da
stack): embeddings para retrieval de contexto e few-shot, com a regra registrada no M5 —
namespace por classificação, e retrieval sempre pós-filtrado por ACL (o canal
"embeddings" da noninterference agora tem teste).

**Evaluation framework (obrigatório desde o Degrau 1).** Suíte versionada com os campos
da blueprint: `eval_case { input, context, allowed_tools, expected_facts,
expected_action, forbidden_actions, rubric, result, model_version, prompt_version,
agent_version }`. Métricas: `task success, groundedness, tool-selection accuracy,
action accuracy, permission violations, hallucination rate, latency, cost,
human override, recovery rate`. Roda em CI por mudança de prompt/modelo/agente; promoção
de qualquer versão exige suite verde + zero permission violations.

**Degrau 1 — LLM read-only sobre a Ontology (R7).** Pergunta em NL → planner read-only
→ tools de leitura → resposta com citações de objetos. Sem write de espécie nenhuma —
não existe tool de escrita no registry neste degrau. Aqui aterrissam o "NL query" da F9
(T8.14) e a noninterference do canal LLM do M5. **Aceite:** pergunta respondida com
grounding citando objetos; troca de modelo sem quebrar nada.

**Degrau 2 — agent → function (R7).** O planner ganha a tool `function.invoke`: o agente
executa Functions (M4) — cálculo sem efeito colateral, já autorizado. Tool-selection
accuracy entra nas métricas: dado o eval_case, o agente escolhe a function certa com os
argumentos certos. **Aceite:** evals de seleção de tool verdes; function invocada pelo
agente produz resultado idêntico ao da invocação direta (paridade).

**Degrau 3 — agent → proposed action (R8).** Nasce o **state-machine agent** da
blueprint, com os estados literais: `START → UNDERSTAND → GATHER_DATA → ANALYZE →
PROPOSE_ACTION → APPROVAL? → EXECUTE → VERIFY → DONE`. Cada state determina
`allowed_tools, prompt, transition_conditions, maximum_iterations, approval_policy` —
definição declarativa versionada, não código improvisado. Neste degrau o agente **só
propõe**: `action.propose` gera um ActionRequest completo (targets, parameters,
expectedObjectVersions, idempotencyKey, reason) **validado mas não executado**,
apresentado ao humano com a justificativa e os dados que o fundamentaram.

**Degrau 4 — authorized action, com humano aprovando (R8).** O **high-risk action gate**
da blueprint, literal: `Agent proposes → simulate → validate → policy → human approval
if required → execute → verify`. Simulate: dry-run da Action contra o estado atual
(preconditions + validações, sem commit). Validate: parameterSchema + postconditions
projetadas. Policy: authorize com o principal **do aprovador humano**, não do agente.
Human approval: UI de aprovação mostra diff simulado + reason + risco (`risk_level` da
Action); aprovação é ela mesma uma Action auditada. Execute: pelo **mesmo Action engine
da R5** — nenhum caminho paralelo de escrita para agentes. Verify: re-leitura dos objetos
+ postconditions; divergência abre incidente. Actions com `risk_level: high` têm
`approval_policy: always`; baixo risco pode ter aprovação amostrada — mas o default é
sempre aprovar.

#### Com o quê (stack)

TypeScript end-to-end (o agent runtime é código, não framework novo) · **AI Gateway e
state machine em módulo próprio** (`modules/aip`) importando apenas contracts ·
ModelProvider com 2 implementações (API comercial + modelo local via Ollama no compose de
dev — a troca real que o gate exige) · **pgvector** no Postgres existente (retrieval e
few-shot; zero infra nova — exatamente o critério da stack) · Zod para input/output
schemas de tools (mesma fonte dos contracts) · Postgres para `agent_runs`,
`tool_registry`, `eval_cases`, `eval_results` · pg-boss para runs assíncronos de eval ·
pino + OTel (trace por state de agente) · Next.js/shadcn para chat e UI de aprovação ·
fast-check + fixtures adversariais em `packages/testing`.

#### Contratos congelados neste marco

Congelam: **Agent Tool API** (ToolDef com os campos exatos da blueprint + invoke
autorizado) e **Evaluation API** (registrar eval_case, executar suite, comparar
versões) — as duas últimas das 15 APIs centrais da blueprint, em `contracts/v2`. Tipos
definidos já, congelados no fim do marco: `AgentRun`, `StateMachineDef`,
`ProposedAction`. Invariante de design a verificar no gate: AIP não modifica **nenhum**
contrato M0–M6 — se precisasse, o erro seria dos contratos anteriores, não do AIP.

#### Testes obrigatórios

**Adversariais — todos os 11 da blueprint, obrigatórios antes de qualquer write
(Degrau 3):** **T8.A1** prompt injection (instrução maliciosa no input do usuário) ·
**T8.A2** data exfiltration attempts · **T8.A3** unauthorized tool (agente tenta tool
fora de allowed_tools/required_permission — rejeitada) · **T8.A4** fake instructions
dentro de documento (conteúdo indexado tentando comandar o agente) · **T8.A5** poisoned
search result (documento malicioso bem ranqueado tentando desviar o plano) · **T8.A6**
stale context (objeto mudou desde o contexto montado → expectedObjectVersions detecta) ·
**T8.A7** conflicting facts (fontes divergentes → resposta declara conflito, não escolhe
em silêncio) · **T8.A8** infinite tool loop (maximum_iterations corta; run termina
FAILED, nunca pendurado) · **T8.A9** action duplication (retry/idempotencyKey: proposta
duplicada não gera duas execuções) · **T8.A10** tool timeout (degradação controlada) ·
**T8.A11** model outage (provider fora → resposta explícita de indisponibilidade; kill
switch).
Funcionais: **T8.1** groundedness — resposta cita object_ids reais · **T8.2** contexto
por perfil — ACLs diferentes, respostas diferentes · **T8.3** eval suite versionada
rodando em CI · **T8.4** budget/kill switch · **T8.5** transição inválida de estado
impossível · **T8.6** replay inspecionável de AgentRun · **T8.7** model swap — trocar
provider sem mudar código · **T8.8** regressão de versão bloqueia promoção · **T8.9**
permission-aware output — sem vazamento por paráfrase · **T8.10** few-shot retrieval
pós-filtrado por ACL · **T8.11** paridade function.invoke (agente ≡ chamada direta) ·
**T8.12** propose→simulate→validate: proposta inválida nunca chega à aprovação ·
**T8.13** aprovação humana é Action auditada; execução usa o Action engine da R5;
verify detecta divergência · **T8.14** NL query grounding (re-atribuído da F9) +
NL → filter chain herdando ACL.
**Gate de saída (F10, literal da blueprint):** trocar o modelo LLM por outro e comprovar
que **Ontology continua funcionando, Actions continuam funcionando, permissions
continuam funcionando, workflows continuam funcionando** — eval suite completa verde com
o provider alternativo. Se trocar o modelo destrói o sistema, você criou um chatbot, não
uma plataforma operacional.

#### Tasks para o Cursor

156. Contratos Agent Tool API + Evaluation API em `contracts/v2` + ADR "AI nunca é a autoridade" + golden fixtures.
157. Migration: `tool_registry`, `agent_runs`, `agent_run_states`, `eval_cases`, `eval_results` — revisar linha a linha.
158. ModelProvider interface + provider A (API comercial) + config por ambiente; nenhum segredo no artefato.
159. AI Gateway: pipeline Identity+Context → Policy → runtime → policy filtering → response, com trace ponta a ponta.
160. Tool Registry: ToolDef validada em zod + invoke passando por authorize com o principal do usuário (T8.A3).
161. Tools read-only v1: `ontology.queryObjects`, `ontology.getObject`, `search.search` como wrappers dos contracts.
162. Context builder: identity+role+permissions+object context+conversation+available_tools filtradas (T8.2).
163. Policy filtering na saída: reavaliação da resposta contra policy_tags do contexto (T8.9).
164. Degrau 1: chat read-only com citações clicáveis de objetos + evals de groundedness (T8.1) + aceite R7 parcial.
165. Evaluation framework: eval_cases versionados, runner, métricas (10 da blueprint), CI gate (T8.3/T8.8).
166. pgvector: namespace por classificação + retrieval pós-filtrado por ACL (T8.10) + ADR.
167. Degrau 2: `function.invoke` + evals de tool-selection accuracy + paridade com chamada direta (T8.11).
168. State-machine agent: StateMachineDef declarativa (9 estados literais da blueprint) + enforcement de transições/budget (T8.5/T8.A8) + replay de AgentRun (T8.6).
169. Degrau 3: `action.propose` — ActionRequest completo validado, não executado, com justificativa groundada.
170. Degrau 4: high-risk action gate — simulate (dry-run) → validate → policy → UI de aprovação humana → execute via Action engine da R5 → verify (T8.12/T8.13).
171. Suíte adversarial completa T8.A1–T8.A11 como fixtures versionados + execução em CI antes de habilitar qualquer write.
172. Provider B (modelo local) + gate F10: eval suite verde após troca de modelo (T8.7) + `docs/arch/aip.md` + ADR "autonomia sem humano = decisão de negócio, fora de release".

### M9 — CLOSED-LOOP + HARDENING SISTÊMICO (cobre F11 completa da blueprint original · pós-R8)

**Por que nesta posição:** a F11 é **validação sistêmica, não construção** — é o único
marco que a blueprint original já tinha na posição certa. Nada aqui é feature nova:
é a prova, sob falha e sob carga, de que o ciclo que define o produto (DATA → MODEL OF
WORLD → UNDERSTANDING → DECISION → ACTION → WORLD CHANGES → NEW DATA) fecha de ponta a
ponta com todas as camadas construídas em M0–M8 ligadas ao mesmo tempo.

**Erros corrigidos aqui:** nenhum novo; é o fechamento de **E7** — o risco "ano sem
valor" só está definitivamente morto quando o ciclo inteiro roda sob teste.

#### Patentes → problema técnico → invariante

A blueprint original **não associa patentes à F11** — e isso é coerente: hardening
sistêmico não é território de patente, é disciplina de engenharia. Os invariantes deste
marco derivam dos testes sistêmicos do próprio documento (chaos, DR, load, replay), não
de claims. Nenhuma patente é inventada aqui.

#### O que construir

**O teste E2E obrigatório de 17 passos — reproduzido na íntegra da blueprint.** Um único
cenário automatizado (Playwright + Testcontainers) que executa, nesta ordem exata:

1. novo dado aparece no sistema fonte
2. connector detecta
3. event é persistido
4. dataset recebe nova versão
5. pipeline incremental executa
6. lineage registra dependência
7. entity resolution encontra entidade
8. ontology atualiza object
9. function recalcula
10. workflow detecta condição
11. agent/usuário decide
12. action é autorizada
13. write-back acontece
14. sistema fonte muda
15. connector recebe novo estado
16. ontology converge
17. audit mostra todo o ciclo

Cada passo é asserção independente (não basta "o teste passou": cada um dos 17 tem
verificação própria e nomeada). Na letra da blueprint: **esse teste vale mais do que
centenas de telas.** O passo 17 é o fechamento: uma única query de audit retorna o ciclo
completo, com actor, reason e hashes encadeados do evento fonte ao write-back.

**Chaos testing.** Desligar deliberadamente, um por vez e em combinação, cada componente
do sistema — a lista literal da blueprint: **connector, message broker (outbox/pg-boss),
storage node (MinIO), search index (Meilisearch), graph (Postgres), action worker, LLM,
external API** — e verificar **degradação**, não morte: o restante do sistema continua
respondendo dentro do seu escopo, com erros explícitos e recuperação automática quando o
componente volta. Toxiproxy + compose de teste; cada cenário vira teste de regressão.

**Disaster Recovery.** Definir e **exercitar** (não documentar): RPO e RTO declarados por
classe de dado (store imutável, metadados, audit, índices — índices são reconstituíveis,
não backup); backup automatizado (Postgres `pg_dump`/`wal` + MinIO versionado); restore
**testado de verdade** em ambiente limpo — um backup nunca restaurado é uma hipótese;
cross-region strategy (documentada como decisão: ativa só quando houver segundo ambiente
real — até lá, restore cross-host); key recovery (rotação e recuperação das chaves de
assinatura de mutations/audit); configuration recovery (Environment/Configuration
Registry do M0 restaurável independentemente de código).

**Load testing por dimensão.** Testar **separadamente** cada eixo da blueprint:
`events/sec` (ingestão), `objects` (volume do Object Store), `relationships` (densidade
do grafo), `dataset size`, `concurrent users`, `queries/sec`, `actions/sec`,
`agent tool calls/sec`. Um eixo por vez, depois combinações: carga composta esconde o
gargalo real. Orçamentos declarados por eixo; regressão de p95 = CI vermelho.

**Replay completo.** Pegar uma **janela histórica** real (ex.: 30 dias de eventos) e
reconstruir a plataforma **do zero**: eventos → versões → transforms → objetos →
projeções de índice. O estado reconstruído deve ser **equivalente** ao estado atual
(mesmos content_hashes de versões, mesmos objetos canônicos, mesmos counts por
ObjectType). É o teste que transforma todas as invariantes anteriores (imutabilidade,
determinismo, lineage) numa única prova end-to-end — e é também o procedimento real de
recuperação catastrófica.

#### Com o quê (stack)

Playwright + Testcontainers (E2E) · toxiproxy (chaos: latência, partição, kill) · k6
(load por eixo) · pg_dump/WAL archiving + MinIO versioning + scripts de restore
exercitados em CI noturno · docker compose (todo o hardening roda na stack fixa — DR e
chaos não são desculpa para infra nova; K8s segue como upgrade nomeado para quando
existir segundo ambiente real).

#### Contratos congelados neste marco

Nenhum. M9 não introduz interface: ele **verifica** os 15 contratos centrais sob falha e
sob carga. Se o hardening exigir mudança de contrato, ela entra por ADR normal em
`contracts/v3` — nunca como efeito colateral de teste.

#### Testes obrigatórios

F11 (renumerados, todos preservados): **T9.1** E2E de 17 passos — cada passo com asserção
nomeada · **T9.2** chaos por componente (8 itens da lista da blueprint) — degradação
verificada + recuperação automática · **T9.3** chaos combinado (2 componentes) — sem
corrupção de estado · **T9.4** DR: restore completo em ambiente limpo dentro de RPO/RTO
declarados · **T9.5** key recovery + configuration recovery exercitados · **T9.6** load
por eixo (8 dimensões da blueprint), orçamentos verdes · **T9.7** replay de janela
histórica — estado reconstruído ≡ estado atual (hashes e counts) · **T9.8** audit do
ciclo: passo 17 retorna o ciclo completo com cadeia de hash válida.
**Gate de saída (F11):** T9.1 verde de ponta a ponta **enquanto** um componente não
crítico está derrubado (E2E sob degradação), restore exercitado dentro do RTO, e replay
equivalente. É o Definition of Done operacional da plataforma.

#### Tasks para o Cursor

173. Harness E2E: cenário-script dos 17 passos com asserções nomeadas por passo (T9.1).
174. Passo 17: query de audit do ciclo completo + verificação da cadeia de hash (T9.8).
175. Chaos kit: toxiproxy no compose de teste + cenários dos 8 componentes com asserções de degradação e recuperação (T9.2/T9.3).
176. DR: backup automatizado (Postgres + MinIO) + RPO/RTO declarados por classe de dado + ADR.
177. Restore exercitado: script de restore em ambiente limpo rodando em CI noturno (T9.4) + key/configuration recovery (T9.5).
178. Load por eixo: 8 dimensões com orçamentos declarados + regressão de p95 no CI (T9.6).
179. Replay de janela histórica: rebuild do zero + comparador de equivalência (hashes/counts) (T9.7).
180. Gate F11: E2E verde sob degradação + `docs/arch/hardening.md` + checklist final do Definition of Done (16 itens) verificado item a item.

## Encerramento

### O que não vira core

A blueprint original é explícita: existem patentes Palantir que são **aplicações
verticais ou funcionalidades especializadas**, não fundação do modelo operacional. Elas
mostram o que dá para construir **sobre** a plataforma, mas não devem bloquear nem
direcionar o desenvolvimento da Ontology, das Actions ou do AIP. Lista completa do
documento original:

- **US 9,129,219 / US 9,836,694** — crime-risk analysis.
- **US 9,501,202** — genomic workflow.
- **US 9,431,507** — distributed acoustic sensing.
- **US 9,872,083 / US 10,708,669** — media/ad insertion.
- **US 8,494,941** — financial-instrument similarity.
- **US 9,830,157 / US 9,676,662** — image/event metadata.
- **US 9,606,647** — gesture management.
- **US 11,706,090** — computer-network troubleshooting.

Se um dia um desses domínios virar seu caso de uso, ele entra **como aplicação**
(consumindo Ontology/Function/Action/Search APIs) — nunca como camada da plataforma.

### Design patents

O portfólio público contém ainda dezenas de **design patents** — aparência de interfaces,
não arquitetura. Lista completa do documento original:

D781869 · D796550 · D802000 · D802016 · D803246 · D808991 · D810101 · D810760 ·
D811424 · D822705 · D826269 · D834039 · D883301 · D883997 · D888082 · D891471 ·
D894199 · D894944 · D894958 · D899447 · D908714 · D910047 · D914032 · D916757 ·
D916789 · D919645 · D920345 · D928807 · D930010 · D933674 · D933675 · D933676 ·
D934290 · D941318 · D946615 · D953345 · D957409 · D963692 · D977494 · D1083953

**A regra:** interpretar design patent como requisito de backend é um erro de categoria.
Elas entram numa **trilha separada de UX clean-room**: não copiar a aparência das
interfaces Palantir; construir o visual da sua app operacional do zero (shadcn/ui já
garante distância visual). Design patents **não são requisito técnico de nenhum marco
M0–M9** — por isso não apareceram em nenhuma tabela de patentes deste documento.

### Definition of Done da plataforma

Reproduzido da blueprint original. A plataforma só está funcionalmente próxima do modelo
estudado quando **todas** estas 16 propriedades coexistirem — verificadas item a item na
task 180:

1. Integra sistemas sem substituí-los.
2. Mantém dados/versionamentos históricos reproduzíveis.
3. Processa transformações incrementalmente.
4. Conhece lineage completo.
5. Aplica autorização de ponta a ponta.
6. Reconcilia identidades entre fontes.
7. Transforma dados físicos em objetos semânticos.
8. Relaciona objetos em um operational graph.
9. Expõe Functions sobre esse modelo.
10. Expõe Actions capazes de alterar o mundo externo.
11. Mantém auditabilidade dessas mudanças.
12. Permite que aplicações diferentes usem o mesmo modelo.
13. Permite que LLMs consultem a Ontology sem acesso irrestrito aos dados.
14. Permite que agentes invoquem somente ferramentas permitidas.
15. Avalia agentes automaticamente.
16. Pode executar uma Action, observar a consequência e atualizar novamente a Ontology.

O item 16 é o fechamento — o ciclo `DATA → MODEL OF WORLD → UNDERSTANDING → DECISION →
ACTION → WORLD CHANGES → NEW DATA` rodando em produção. É o objetivo arquitetural final,
e é exatamente o que o teste T9.1 de 17 passos prova.

### Regra jurídica das patentes

Reproduzindo a regra da blueprint original, que é tecnicamente e juridicamente correta:
**não implemente uma patente pensando "vou copiar o mecanismo descrito no claim".** Use
as patentes como mapa de problemas que a Palantir precisou resolver:

```
patent → technical problem → invariant → independent architecture → tests
```

Todas as tabelas deste documento (M0–M9) seguiram esse pipeline: cada patente virou um
problema técnico, um invariante testável e uma arquitetura **independente** — nenhuma
implementação aqui reproduz mecanismo de claim.

Isso importa porque várias famílias citadas aparecem como **ativas** ou possuem
aplicações recentes/**pending**: por exemplo, o Google Patents lista **US 12,405,983
como ativa** e **US20250165857 como pending** — e a própria base ressalva que esse
status **não constitui conclusão jurídica**. Portanto: para uso interno/estudo, o
pipeline acima é suficiente; para **produto comercial**, a implementação deve ser
independente (como aqui) **e** uma análise de **freedom-to-operate** precisa ser feita
por profissional de propriedade intelectual antes de qualquer decisão de copiar
mecanismos potencialmente cobertos por claims ativos. Status de patente é insumo para
esse profissional — não é veredito, e não é decisão de engenharia.
