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
