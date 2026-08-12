# BLUEPRINT TÉCNICA + ROADMAP DE CONSTRUÇÃO
## Plataforma "Palantir-like" — revisada, reordenada e pronta para implementar no Cursor

> **Como usar este documento:** as seções 1–3 são a análise crítica da sua blueprint
> original (o que está certo, o que está errado e por quê). A seção 4 é o veredicto sobre
> a ordem. As seções 5–9 são o material de execução: roadmap, stack, contratos congelados
> e instruções de trabalho com o Cursor. Cole as seções 5–9 como contexto no Cursor
> (`.cursor/rules/` + `docs/arch/`) e execute as tasks na ordem dada.

---

# PARTE 1 — ANÁLISE DA BLUEPRINT ORIGINAL

## 1.1 O que está excelente (manter)

Sua blueprint é forte em **conteúdo por fase** e tem três acertos conceituais raros:

1. **"Interfaces estáveis antes da camada superior"** — este é o princípio correto e ele
   atravessa todo o documento. Os 15 contratos centrais (Connector API, Dataset API,
   Transformation API, Lineage API, Policy API, Ontology API, Function API, Action API,
   Workflow API, Search API, Agent Tool API...) são de fato a espinha dorsal.
2. **Gates de saída testáveis por fase** — "Qual era o estado do dataset às 14:37:22?",
   "trocar o LLM sem quebrar nada", "duas UIs sem duplicar lógica". São critérios de
   aceite de verdade, não burocracia. Mantive todos no roadmap.
3. **O ciclo fechado como definição do produto** — DATA → MODEL → DECISION → ACTION →
   WORLD CHANGES → NEW DATA. A blueprint está certa: esse ciclo é o produto, e o
   "primeiro vertical slice" é a estratégia correta de implementação.
4. **Usar patentes como mapa de problemas, não como código** — patent → technical
   problem → invariant → independent architecture → tests. Correto técnica e
   juridicamente.

## 1.2 O problema central: a numeração F0–F11 contradiz os próprios milestones A–L

A blueprint contém **duas ordens diferentes**:

- A ordem das **fases** (F0 → F1 → ... → F11), sequencial e completa;
- A ordem dos **milestones** (A → L) e o vertical slice, incremental e demonstrável.

Os milestones estão certos. As fases, lidas literalmente como plano de construção,
induzem a três erros graves (detalhados abaixo). **A ordem revisada deste documento
transforma os milestones no plano oficial** — as "fases" viram domínios de engenharia
que amadurecem ao longo de vários marcos, em vez de gates sequenciais.

## 1.3 Os 3 erros de ordem encontrados

### Erro 1 — F5 (Replication/Offline) na posição 5 é o maior erro da sequência

O protocolo de replicação descrito na F5 replica `mutation_id`, `object`, `operation`,
`policy` — ou seja, **mutações de objetos da Ontology (F7) e Actions (F8)**, não
dataset versions. As patentes citadas são *Cross-Ontology* (US 9,330,157) e *redacted
graph collaboration* (US 9,501,761) — grafos de objetos, não dados brutos.

Construir F5 na posição 5 significa projetar um protocolo de replicação contra a
abstração errada (dataset versions) e **reescrevê-lo** quando F7/F8 introduzirem
object mutations com resolução semântica de conflito. Além disso, nenhuma fase F6–F10
depende de replicação — ela é produto avançado (cenário desconectado/multi-org), não
fundação. **Correção: F5 vai para depois de F9, sobre objetos e actions.**

### Erro 2 — F4 (Security) está tarde demais como segurança e cedo demais como lineage completo

Dois problemas simétricos:

- **Tarde demais:** o teste T1.7 ("usuário sem acesso à fonte não pode obter o dado via
  connector"), o sandbox da F3 (identity, audit) e o campo `principal` obrigatório nos
  logs da F0 já exigem identidade e policy **antes** da F4. Na ordem literal, F1–F3 são
  construídas sem segurança real, e retrofit de autorização em connector, storage e
  sandbox é o caminho clássico para "security theater" — o enforcement tem que estar no
  caminho de *todo* read/write.
- **Cedo demais:** o lineage graph da F4 inclui OBJECT e MODEL OUTPUT como nós, que só
  existem em F7 e F10.

**Correção: dividir F4 em duas.** F4a (identidade + policy engine mínimo + audit
estruturado) sobe para a fundação; F4b (lineage colunar, propagação de classificação,
redaction, noninterference) fica onde está, como hardening.

### Erro 3 — F6 (Entity Resolution) antes de F7 (Ontology) é parcialmente circular

A própria blueprint admite o ciclo sem resolvê-lo: a patente US20250165857 que ela cita
descreve ER *contra entidades já presentes numa ontology*, e o candidate generation da
F6 usa "ontology neighborhood" e "relationships" — que só existem na F7. O gate da F6
("só avançar para Ontology quando a identidade canônica for confiável") é literalmente
impossível de cumprir sem uma Ontology mínima para onde resolver entidades.

**Correção: construir F6 e uma F7-lite juntas, convergindo** — exatamente o que o
Milestone C já sugeria ("entity resolution + ontology mínima").

## 1.4 Dependências implícitas que a blueprint não declara

| Dependência oculta | Evidência textual | Impacto |
|---|---|---|
| **Identidade/IAM não existe em fase nenhuma** | `principal` exigido na F0.4; `actor` no T0.5; USER/GROUP/ROLE no authorization graph da F4 | Gap crítico — corrigido no M0 da ordem revisada |
| **F2 referencia F4** | version record com `policy_id` e `lineage_ref` | Acoplamento circular; corrigido com campos reservados desde R1 |
| **F8 depende de F1** | write-back passa por connectors | Ciclo F1→…→F8→F1 escondido; ok se connectors forem plugáveis |
| **F6 depende de UI de revisão humana** | "human feedback when needed" — UI só existe na F9 | Corrigido: fila de revisão mínima entra na R3 |
| **Event bus nunca é construído** | "Canonical Event Bus" (F1) e "message broker" (F11) aparecem sem dono | Corrigido: decisão de mensageria no M0/R1 |
| **Federation planner reaparece na F9** | Query planner da F9 inclui "Federation" | Reforça que federation deve ser adiada |

## 1.5 Gaps técnicos para a blueprint ser implementável

1. **Identidade/IAM/SSO** — nenhuma fase define IdP, tokens, service identity ou o store
   de USER/GROUP/ROLE. Maior gap da blueprint.
2. **Mensageria/event bus** — sem escolha tecnológica nem semântica de entrega
   (at-least-once? ordering por chave?). Define F1, F2 (replay), F5 e F11.
3. **Stack de storage** — object storage, DB transacional, graph store, motor de busca:
   nenhuma escolha, nenhum critério.
4. **Migração de schema do próprio sistema** — a F7 trata schema evolution *dos dados
   do cliente*; nada versiona os metadados da plataforma (registries, policy store).
5. **Contract testing / API gateway** — 15 contratos declarados sem estratégia de
   compatibilidade. O gate da F1 ("nova fonte sem alterar o core") exige testes de
   contrato automatizados.
6. **Ambientes e dados de teste** — sem dev/staging, seeds, gold set inicial (a F6
   exige um e ninguém o produz) nem dados sintéticos para os testes T1.x.
7. **Tenancy** — `tenant` aparece como contexto de policy, mas o isolamento não é
   arquitetado.
8. **Backup/DR** — só checklist na F11; para um immutable store que é *system of
   record*, backup nasce na F2.
9. **Observabilidade de custo** — compute da F3, LLM da F10, crescimento do delta tree.
10. **Operação do Connector Runtime** — deploy de connectors, rate limiting contra
    fontes, rotação de credenciais.

## 1.6 Os 5 maiores riscos de seguir a ordem literal

1. **"Ano sem valor" (severidade máxima).** F0 completa + F1 completa + F2 completa
   antes de qualquer demo = 6–9 meses de infra sem provar o ciclo. Mitigação: gates
   mínimos por release, não fases completas.
2. **Replication sem nada para replicar** (Erro 1 acima) — trabalho jogado fora com
   alta probabilidade.
3. **Retrofit de segurança** em connector/storage/sandbox — reescrever camadas de
   acesso e repetir todos os testes de não-interferência.
4. **Bloqueio artificial no gate F6→F7** — ER resolvendo contra o nada.
5. **Acoplamento F2↔F4 não gerenciado** — num store *imutável*, adicionar campos
   retroativamente aos manifests é particularmente caro.

---

# PARTE 2 — A ORDEM CERTA: VEREDICTO E ROADMAP DE CONSTRUÇÃO

## 2.1 O que construir primeiro, segundo, terceiro... e POR QUÊ

A sequência correta segue uma regra única: **nenhum engine é generalizado antes de ser
usado pelo slice**. Connector, store, policy e ontology nascem mínimos e endurecem
quando um consumidor real exige. Cada marco fecha um loop demonstrável.

### 1º — M0: Fundação mínima (F0 reduzida + Identidade + Mensageria)
**O quê:** build, 1 ambiente, observabilidade com `principal` em todo log, **IAM/SSO +
secrets**, event bus, tenancy básica (mesmo que single-tenant, com o campo presente).
**Por quê primeiro:** tudo que as camadas seguintes emitem carrega principal e
policy_tags desde o primeiro evento. Identidade é a única coisa que **não pode ser
retrofitada** — se entrar depois, você reescreve o caminho de todo read/write.
**Por quê "mínima":** a F0 completa (canary, rollback multi-ambiente, build graph) é
trabalho de meses que não prova valor nenhum. Escopo deliberadamente "chato e pequeno".

### 2º — M1: Ingestão + Store imutável (F1 essencial + F2)
**O quê:** 1 connector (snapshot + incremental + checkpoint), event envelope canônico,
schema registry, dataset versioning com imutabilidade e time travel. `policy_id` e
`lineage_ref` entram como **campos reservados** no version record desde o dia 1.
**Por quê em segundo:** é a primeira propriedade demonstrável da plataforma — "dado
entra, história é reproduzível". Sem isso não há o que transformar, resolver ou mapear.
**Por quê não federation/edge aqui:** o slice usa snapshot+CDC apenas; pushdown query
planner é um projeto inteiro que só se paga com uma fonte que realmente não pode ser
copiada.

### 3º — M2: Transformação + Segurança mínima (F3 + F4a)
**O quê:** runner de transformações versionadas, DAG de dependências, scheduler
incremental, lineage por versão — **e** o policy engine `authorize()` + audit
estruturado + security matrix nas APIs de F2/F3.
**Por quê em terceiro:** o gate da F3 (incremental recompute) exige o versionamento da
F2; e o enforcement de policy passa a existir **antes** de dados sensíveis fluírem por
transforms — evita o retrofit de segurança (risco #3).
**Por quê só "mínima":** lineage colunar, propagação de classificação e redaction só
fazem sentido endurecer quando já existem transforms e objetos reais propagando dados
(vira o M5).

### 4º — M3: Vertical slice semântico (F7-lite + F6 juntas + F4b inicial)
**O quê:** Ontology registry (ObjectType, mapping versionado, Object API), ER
determinístico (blocking + scoring por regras) **resolvendo contra a Ontology-lite**,
gold set, fila de revisão humana, lineage dataset→object.
**Por quê em quarto e por quê juntas:** resolve a circularidade F6↔F7 (Erro 3). ER sem
Ontology resolve contra o nada; Ontology sem ER materializa duplicatas. É o coração do
produto — o primeiro momento de **valor de negócio visível**: "ACME LTDA" da fonte A e
"Acme Ltda." da fonte B convergem para um único objeto `Customer` com provenance.

### 5º — M4: Closed loop operacional (F8 + F9-lite)
**O quê:** Function registry, **uma Action real** com o pipeline fixo
authorize→validate→tx→write-back→audit, optimistic concurrency, idempotency key,
busca de objetos permission-aware.
**Por quê em quinto:** aqui a plataforma executa pela primeira vez o ciclo
observe→decide→act→write-back — o "produto" que a própria blueprint define. O
write-back volta pelo connector (dependência F8→F1), fechando o loop no sistema fonte.

### 6º — M5: Hardening de segurança (F4 completa)
**O quê:** lineage colunar, propagação de classificação via lineage (inclusive para
outputs de modelos), redaction com reparo de arestas, testes de noninterference,
fuzzing de autorização (principal × resource × action × context).
**Por quê aqui e não antes:** endurecer propagação antes de existirem transforms,
objetos e actions reais é especular sobre caminhos de dados que ainda não existem.

### 7º — M6: Escala de acesso (F9 completa + F1 avançado)
**O quê:** query planner multi-backend, índice permission-aware completo (facet, count,
autocomplete, snippet), aplicações operacionais, federation/pushdown **se** houver fonte
que justifique, edge/SCADA **se** houver demanda.
**Por quê aqui:** search em escala só se prova com volume real de objetos; federation
só se paga com uma fonte grande/sensível real.

### 8º — M7: Distribuição (F5 inteira, na posição correta)
**O quê:** replication cross-ACL, offline, conflict resolution — **sobre mutações de
objetos e actions**, não dataset versions.
**Por quê só agora:** agora existe o que replicar — exatamente o que as patentes
Cross-Ontology/Cross-ACL tratam. O protocolo é projetado uma vez só, contra a
abstração certa.

### 9º — M8: AIP progressivo (F10 em degraus)
**O quê:** LLM read-only sobre a Ontology → agent→function → agent→proposed action →
agent→authorized action. Eval framework desde o primeiro degrau; testes adversariais
antes de qualquer write.
**Por quê por último (antes do hardening final):** AIP é **consumidor** da plataforma,
não fundação. Cada degrau de autonomia exige o anterior provado. O gate é o melhor do
documento: *trocar o modelo LLM e nada quebrar — senão você criou um chatbot.*

### 10º — M9: Closed-loop + Hardening sistêmico (F11)
**O quê:** o teste E2E de 17 passos, DR/backup, chaos testing, load, replay completo.
**Por quê por último:** é validação sistêmica, não fase de construção. Correto como
está na blueprint — mantido.

### Visão resumida

```
HOJE:  M0 Fundação+IAM → M1 Ingest+Store → M2 Transform+Policy → M3 ER+Ontology
         ↓ (aqui você já tem valor de negócio demonstrável)
       M4 Loop operacional → M5 Security hardening → M6 Search/Apps+Federation
         ↓
       M7 Replication/Offline → M8 AIP → M9 Closed-loop E2E
```

## 2.2 Roadmap executável: 8 Releases (R1–R8)

Cada release fecha um loop demonstrável. "FORA" é tão importante quanto o escopo.

| Release | Cobre | Objetivo | Entra | FORA (explícito) | Critério de aceite demonstrável |
|---|---|---|---|---|---|
| **R1** | M0+M1 | Fundação + ingestão imutável | Monorepo, compose, contratos v0, IAM básica, 1 connector (Postgres), event envelope, raw store, dataset versioning | CDC avançado, federation, schema drift avançado, UI | "Qual o estado do dataset X às 14h de ontem?" respondida de forma determinística via API (`snapshot(timestamp)`), com diff entre versões |
| **R2** | M2 (F3) | Transformação + lineage | SQL versionado (DuckDB), DAG de deps, scheduler incremental, lineage por versão, data quality básica, quarentena | DSL própria, sandbox de código custom, rule engine completo | Altero 1 linha na fonte → só os datasets descendentes recalculam; grafo input→output visível com hashes |
| **R3** | M3 | ER v0 + Ontology v0 | Ontology registry, mapping versionado, ER determinístico, canonical entities, Object API, gold set, fila de revisão | ML de matching, links inferidos, security por property | "ACME LTDA" (A) + "Acme Ltda." (B) → 1 objeto `Customer` com provenance e score auditável; precision/recall no gold set de 50 pares |
| **R4** | M2 (F4a) + 2ª fonte | Policy + Audit | `authorize()` central, roles/groups, audit log hash-chained, propagação de classificação via lineage, 2º connector, links | Cross-ACL replication, redaction de grafo, noninterference total | Usuário sem permissão não vê o objeto **nem o count**; audit log detecta adulteração (verificação de cadeia de hash) |
| **R5** | M4 | **Vertical slice completo** | Function registry, Action engine (precondição→auth→validação→tx→write-back→audit), optimistic concurrency, idempotency | Workflow engine genérico, saga/compensação, ações multi-step | Fecho o loop na tela: `ReclassifyCustomer` → write-back muda a fonte → connector detecta → nova versão → ontology atualiza → audit mostra o ciclo inteiro |
| **R6** | M6 | Search + App operacional | Meilisearch com ACL no índice, Query API unificada, 1ª app (object explorer + visão grafo) | Geoespacial, mobile, NL query | Duas views diferentes sobre a mesma Ontology **sem uma linha de lógica duplicada**; busca não vaza objeto proibido |
| **R7** | M8 (degraus 1–2) | AIP read-only | AI Gateway, Tool Registry (tool = wrapper de Ontology/Function/Search API), evals versionados, policy filtering no output | Agentes com write, fine-tuning | Pergunta em NL respondida grounded citando objetos; **troco o modelo LLM e nada quebra** |
| **R8** | M8 (degraus 3–4) | Agente com ação proposta→aprovada | State-machine agent (propose→approve→execute→verify), high-risk action gate, suíte adversarial | Autonomia sem humano no loop | Agente propõe Action → humano aprova na UI → executa pelo mesmo Action engine da R5 → eval suite passa nos testes de prompt injection |

> **Nota:** M5 (hardening de segurança), M7 (replication) e M9 (E2E/DR/chaos) ficam
> depois da R8 como tracks de hardening, acionados quando houver dados sensíveis reais,
> cenário desconectado real, ou pré-produção — respectivamente. A "L" da blueprint
> (autonomia total) **não é uma release — é uma decisão de negócio** que só se toma
> depois que a R8 roda meses sem incidente.

---

# PARTE 3 — STACK TÉCNICA (decisões concretas)

Princípio: os "3 bancos + broker + engine" da arquitetura de paper viram **1 Postgres +
1 MinIO + 1 Meilisearch**. Cada item tem um caminho de upgrade nomeado — o que importa
é que nenhum contrato central depende da implementação escolhida.

| Item | Escolha | Por quê | Upgrade futuro |
|---|---|---|---|
| Linguagem | **TypeScript (Node 22) end-to-end** | Uma linguagem maximiza a produtividade da IA e elimina dessincronia de tipos front/back | — |
| Monorepo | **pnpm workspaces + Turborepo** | Contratos, services e apps no mesmo repo permitem à IA refatorar atravessando camadas com segurança | — |
| Arquitetura | **Modular monolith** (1 processo, módulos com fronteiras explícitas) | Microsserviços nas R1–R4 só geram custo operacional; módulos viram serviços depois *se* precisar | Extração por módulo |
| Relacional | **Postgres 16** | Um banco cobre metadados, filas, objetos e FTS até escala muito maior que a imaginada | Particionamento, read replicas |
| Grafo | **Postgres** (`objects`/`links` + recursive CTE) | CTE recursivo resolve traversal de 2–4 hops com folga; Neo4j antes da R6 é complexidade sem retorno | Neo4j |
| Busca | **Meilisearch** | Binário único, zero tuning; índice permission-aware = ACL no documento + filtros | Elasticsearch/OpenSearch |
| Objeto/imutável | **MinIO (S3) + Parquet** | Raw data e versões como arquivos imutáveis com content-hash = 90% da F2 sem JVM | Iceberg/Delta |
| Transform/Compute | **DuckDB (embedded) executando SQL** | Lê Parquet/Postgres nativo, determinístico, dispensa Spark/Airflow por anos | Spark, se >100M eventos/dia |
| Mensageria | **Postgres outbox + LISTEN/NOTIFY** (pg-boss para jobs) | Outbox transacional dá exactly-once lógico com zero infra nova; Kafka no ano 1 é o erro clássico | Kafka/Redpanda |
| Framework de API | **Fastify + Zod** | Zod como fonte única = validação + tipos TS + OpenAPI do contrato | — |
| Auth | **better-auth** atrás de um `IdentityProvider` interno | Toda autorização passa pelo Policy API, nunca pelo middleware — troca por OIDC sem dor | Keycloak/OIDC |
| Orquestração de pipelines | **Scheduler próprio** (topological sort sobre tabela de deps + pg-boss) | O "Dynamic Pipeline Processing" da F3 é ~200 linhas sobre o grafo de dependências | Temporal |
| Frontend | **Next.js + shadcn/ui + TanStack Query** | Ecossistema que o Cursor gera melhor; UI operacional nasce sobre as APIs da Ontology | — |
| Observabilidade | **pino + OpenTelemetry → Jaeger + Prometheus/Grafana** (compose) | Cobre o T0.5 (trace_id, actor, latência) com um dia de configuração | Stack gerenciada |
| Testes | **Vitest + Testcontainers + Playwright** | Testcontainers com Postgres/MinIO reais torna os testes de invariante (T1.1, T1.3, T2) honestos | — |
| IaC / local dev | **docker compose apenas** (postgres, minio, meilisearch, jaeger) | Terraform/K8s só com um segundo ambiente de verdade — até lá é teatro | K8s + Terraform |
| Vetores (R7+) | **pgvector** | Extensão do Postgres que já existe; não adiciona infra | Qdrant/PG dedicado |

---

# PARTE 4 — CONTRATOS CENTRAIS (congelar por release)

Contratos vivem em `packages/contracts`, versionados como `v1/`, `v2/`. Mudança
breaking exige ADR + bump de pasta. CI roda testes de contrato com golden fixtures
para impedir que a IA "melhore" uma assinatura silenciosamente.

```typescript
// ── 1. CONNECTOR API (congela na R1) ──────────────────────────
interface Connector {
  discover(): Promise<SourceObject[]>;                 // o que a fonte expõe
  schema(obj: ObjectRef): Promise<SourceSchema>;       // schema físico + hints
  snapshot(obj: ObjectRef): AsyncIterable<CanonicalEvent>;
  read(cursor: Cursor): AsyncIterable<CanonicalEvent>; // incremental
  checkpoint(): Promise<Cursor>;                       // resumível após crash
  health(): Promise<HealthStatus>;
}
// Regra de ouro: connector NUNCA importa nada da Ontology.

// Envelope canônico (todo dado que entra) — campos exatos da F1 da blueprint:
interface CanonicalEvent {
  event_id: string; source_system: string; source_object: string;
  source_primary_key: string; schema_version: string;
  occurred_at: string; ingested_at: string;
  connector_id: string; checkpoint: string;
  principal: string; policy_tags: string[];
  payload_hash: string; payload: Record<string, unknown>;
}

// ── 2. DATASET / VERSIONING API (congela na R1) ───────────────
interface DatasetStore {
  createDataset(def: DatasetDef): Promise<Dataset>;
  commitVersion(ds: DatasetId, input: CommitInput): Promise<DatasetVersion>;
  // CommitInput: { parentVersion?, inputVersions[], transformationId?,
  //                schemaVersion, contentRef, contentHash,
  //                policyId,        // reservado p/ R4 (F4)
  //                lineageRef }     // reservado p/ R2
  getLatestVersion(ds: DatasetId): Promise<DatasetVersion>;
  getVersion(v: VersionId): Promise<DatasetVersion>;
  diff(a: VersionId, b: VersionId): Promise<VersionDiff>;
  snapshot(ds: DatasetId, at: Timestamp): Promise<DatasetVersion>; // time travel
  listVersions(ds: DatasetId, range?: TimeRange): Promise<DatasetVersion[]>;
}
// Invariante: versão commitada é imutável; "alteração" = nova versão com parentVersion.
// Invariante de replay: snapshot(at) é determinístico — o gate da F2.

// ── 3. TRANSFORMATION API (congela na R2) ─────────────────────
interface TransformationEngine {
  register(t: TransformationDef): Promise<TransformationId>;
  // TransformationDef: { name, version, sql: string, inputs: DatasetRef[],
  //                      output: DatasetRef, validations: Rule[] }
  run(t: TransformationId, inputs: VersionPin[]): Promise<PipelineRun>;
  // PipelineRun: { id, inputVersions[], outputVersion, lineageRef,
  //                startedAt, duration, qualityMetrics, status }
  dependentsOf(v: VersionId): Promise<TransformationId[]>; // p/ scheduler incremental
}
// Determinismo é contrato: mesmo VersionPin[] → mesmo contentHash, ou é bug.

// ── 4. POLICY API (congela na R4; definir o TIPO já na R1) ────
interface PolicyEngine {
  authorize(req: AuthorizeRequest): Promise<Decision>;
}
interface AuthorizeRequest {
  principal: Principal; resource: ResourceRef; operation: string;
  context?: { purpose?: string; environment?: string;
              classification?: string; tenant?: string };
}
type Decision =
  | { allow: true }
  | { allow: false; reason: string }
  | { allow: "partial"; redactedFields: string[] };
// Regra: NENHUM módulo lê storage sem passar por authorize() após a R4.
// Antes da R4: default-allow com TODO marcado + teste de security matrix pendente.

// ── 5. ONTOLOGY / OBJECT API (congela na R3) ──────────────────
interface OntologyRegistry {                            // semântica (schema)
  defineObjectType(t: ObjectTypeDef): Promise<OntologyVersion>;
  getObjectType(id: string, version?: number): Promise<ObjectType>;
  defineLinkType(l: LinkTypeDef): Promise<OntologyVersion>;
  bindMapping(m: MappingDef): Promise<MappingId>;       // dataset→object, versionado
}
interface ObjectService {                               // instâncias vivas
  getObject(id: ObjectId, at?: Timestamp): Promise<OntologyObject>;
  queryObjects(q: ObjectQuery): Promise<Paged<OntologyObject>>;
  traverseLinks(id: ObjectId, linkType: string, depth?: number): Promise<ObjectGraph>;
  getHistory(id: ObjectId): Promise<ObjectRevision[]>;
  getProvenance(id: ObjectId): Promise<Provenance>;     // → dataset_versions → eventos
}
// OntologyObject: { objectId, objectType, ontologyVersion, properties,
//                   links, provenance, policyTags }
// Toda leitura passa por PolicyEngine.authorize() — sem exceção.

// ── 6. ACTION API (congela na R5; definir o TIPO já na R1) ────
interface ActionEngine {
  register(a: ActionDef): Promise<ActionId>;
  // ActionDef: { id, inputObjectTypes[], parameterSchema (zod),
  //              preconditions, authorizationPolicy, validation,
  //              sideEffects: WriteBackSpec[], postconditions }
  execute(req: ActionRequest): Promise<ActionResult>;
}
interface ActionRequest {
  actionId: ActionId;
  actor: Principal;
  targets: ObjectId[];
  parameters: unknown;                           // validado por parameterSchema
  expectedObjectVersions: Record<ObjectId, number>; // optimistic concurrency
  idempotencyKey: string;                        // obrigatório p/ write-back
  reason: string;                                // vai para o audit
}
type ActionResult =
  | { status: "committed"; newState: OntologyObject[]; auditId: string }
  | { status: "denied"; policyReason: string }
  | { status: "conflict"; currentVersions: Record<ObjectId, number> }
  | { status: "validation_failed"; violations: Violation[] };
// Pipeline interno FIXO: authorize → validate → tx → write-back → audit.
// LLM/UI NUNCA escrevem direto no banco. Sempre via Action.
```

---

# PARTE 5 — SEQUÊNCIA DETALHADA DAS PRIMEIRAS 3 RELEASES

Cada task `NNN` é dimensionada para **1 sessão de Cursor** (1–3 arquivos + testes,
~30–60 min). Execute na ordem. Cada sessão termina com `pnpm test` verde + commit.

## R1 — Fundação + ingestão imutável

1. `001` Scaffold monorepo: pnpm workspaces, `tsconfig.base.json`, eslint, vitest, Turborepo.
2. `002` `docker-compose.yml`: postgres:16, minio, jaeger, prometheus+grafana + script `dev:up`.
3. `003` Package `@platform/contracts`: `CanonicalEvent` (zod, campos exatos do §Parte 4) + teste round-trip.
4. `004` Contrato **Dataset API** v0 em zod/TS + ADR-0001 "contratos congelam por release".
5. `005` Migration SQL 0001: `datasets`, `dataset_versions`, `events`, `schema_registry` (incluir `policy_id`, `lineage_ref` como colunas nullable reservadas).
6. `006` Identidade mínima: better-auth + tabela `principals`; middleware que injeta `principal` em todo request/log.
7. `007` `DatasetStore.commitVersion()`: grava Parquet no MinIO, content-hash sha256, append-only, rejeita mutação de versão commitada.
8. `008` `getVersion/getLatest/diff/snapshot(timestamp)` + teste de time travel (gate da F2).
9. `009` Testes: duplicate commit (mesmo conteúdo → mesma versão); crash entre write e commit (transação com outbox).
10. `010` Contrato **Connector API** v0 + tipo `Cursor/Checkpoint`.
11. `011` Connector Postgres genérico: `snapshot()` + `read(cursor)` por polling em coluna `updated_at`, emite envelopes.
12. `012` Ingest worker (pg-boss): envelope → valida schema → grava raw → commita versão → atualiza `schema_registry`.
13. `013` Checkpoint persistente + teste T1.3 (matar no evento 10.000, reiniciar, continuar certo).
14. `014` Teste T1.1: snapshot 2× → resultado lógico idêntico.
15. `015` Middleware de observabilidade: pino + correlation ID + OTel span por request/ingest run (gate T0.5).
16. `016` Classificador de schema drift v0 (compatible/coercible/breaking) + teste T1.4 simplificado.
17. `017` CLI mínima (`pnpm ds snapshot <dataset> --at <timestamp>`) — é a "UI" do critério de aceite.
18. `018` README + ADR-0002 "por que Parquet+MinIO e não Iceberg/Delta".

**Aceite R1:** `snapshot(timestamp)` responde deterministicamente; T1.1 e T1.3 passam;
todo log tem `principal` e `trace_id`.

## R2 — Transformação + lineage

1. `019` Contratos **Transformation API** + **Lineage API** v0.
2. `020` Migrations: `transformations`, `pipeline_runs`, `lineage_edges`, `quality_metrics`.
3. `021` `TransformRunner`: transformation (SQL DuckDB versionado) + input_version_ids → executa → produz output version.
4. `022` Determinismo: mesmo input → mesmo content-hash (teste obrigatório; proibir `NOW()` sem seed).
5. `023` Grafo de dependências derivado das declarações input/output; detecção de ciclo no registro.
6. `024` Scheduler: ao commitar versão, enfileira (pg-boss) **somente descendentes afetados** — o gate da F3.
7. `025` Registro de lineage: toda pipeline_run grava `input_versions[] → output_version` com hash e duration.
8. `026` `LineageService.upstream/downstream(version)` + teste de completude (100% dos outputs apontam inputs).
9. `027` Data quality v0: completeness, uniqueness, freshness pós-run, persistidos.
10. `028` Validação inline: linhas que violam `validations` vão para quarentena com motivo.
11. `029` Replay: reprocessar janela histórica a partir de versões antigas (inputs pinados).
12. `030` Teste do gate: mudar 1 input → `pipeline_runs` mostra que só descendentes rodaram.
13. `031` ADR-0003 "SQL+DuckDB em vez de DSL própria".

**Aceite R2:** mudança em 1 input reconstrói exatamente e somente os outputs dependentes;
grafo de lineage completo e consultável.

## R3 — Entity Resolution + Ontology v0

1. `032` Contratos **Ontology API** e **ER API** v0 (ObjectType, PropertyType, LinkType, OntologyVersion).
2. `033` Migrations: `object_types`, `property_types`, `link_types`, `ontology_versions`, `objects`, `object_history`, `entity_matches`.
3. `034` Ontology registry CRUD versionado (mudança de ObjectType → novo `ontology_version`, nunca update in-place).
4. `035` Mapping versionado dataset→ObjectType (JSON declarativo: coluna → property).
5. `036` Projetor: versão de dataset → upsert em `objects` (`object_history` append-only + provenance → dataset_version).
6. `037` ER v0 — normalização (lowercase, sem acentos/pontuação, CNPJ só dígitos).
7. `038` ER v0 — blocking por chave exata + nome normalizado (SQL, nunca O(n²)).
8. `039` ER v0 — scoring por regras ponderadas (doc = 1.0; nome+cidade = 0.8...) com thresholds match/no-match/review.
9. `040` Persistir tudo em `entity_matches`: score, features, rule_version, decision, reason (exigência da F6).
10. `041` Merge para canonical entity + link `source_record → canonical` sem destruir o original.
11. `042` Gold set (50 pares rotulados à mão) + script de métricas precision/recall/**false-merge-rate**.
12. `043` Fila de revisão humana (tabela + endpoint) para scores na zona cinzenta.
13. `044` Object API: `getObject/queryObjects/getHistory/getProvenance` — toda leitura retorna provenance.
14. `045` Links: materializar relações declaradas no mapping (FK cruzada entre fontes → `links`).
15. `046` Testes de gate: renomear property em nova ontology_version; leitura histórica; integridade referencial de links.
16. `047` ADR-0004 "objetos como projeção versionada, não cópia mutável".

**Aceite R3:** gold set com precision/recall medidos; false merge rate documentado;
`getProvenance` navega objeto → versão → evento fonte.

---

# PARTE 6 — COMO TRABALHAR COM O CURSOR

## 6.1 Estrutura do monorepo (fronteiras físicas ajudam a IA)

```
platform/
├── packages/
│   ├── contracts/        # v1/, v2/ — zod schemas + tipos. INTANGÍVEL sem ADR
│   ├── core/             # DatasetStore, TransformRunner, PolicyEngine, ActionEngine
│   └── testing/          # fixtures golden, factories, helpers de Testcontainers
├── modules/              # ingest, transform, ontology, policy, search, aip
│                         # cada um: index.ts público + internals/
├── connectors/           # postgres, csv, rest — dependem SÓ de contracts
├── apps/
│   ├── api/              # Fastify: monta os módulos como rotas
│   ├── worker/           # pg-boss consumers
│   └── web/              # Next.js
├── docs/
│   ├── adr/              # 0001-contratos-congelam.md, 0002-parquet-minio.md...
│   └── arch/             # ingest.md, ontology.md... 1 página por módulo:
│                         #   propósito, contratos usados, invariantes, o que NÃO fazer
├── migrations/           # SQL numerado, NUNCA gerado livremente pela IA
└── .cursor/rules/        # um .mdc por domínio
```

## 6.2 Arquivos de contexto que funcionam

- **`.cursor/rules/contracts.mdc`** — "Contratos em `packages/contracts` são imutáveis
  dentro de uma release. Se uma task parecer exigir mudança de contrato, PARE e
  proponha um ADR em vez de editar."
- **`.cursor/rules/architecture.mdc`** — o diagrama do loop
  (Source→Connect→Version→Transform→Lineage→ER→Ontology→Function→Action→Write-back)
  + a lista de invariantes testáveis por camada (copie os gates da blueprint como
  checklist).
- **`docs/arch/<modulo>.md`** — máx. 1 página; a IA lê o do módulo que está tocando.
  Atualize no fim de cada release.
- **ADRs curtos** (10–20 linhas): Contexto / Decisão / Alternativa rejeitada /
  Consequência. O Cursor usa ADRs como contexto de "por quê" melhor que comentários.

## 6.3 Mantendo contratos estáveis enquanto a IA gera código

1. Todo contrato tem **golden fixtures** (JSON de request/response) em
   `packages/testing` + teste de contrato no CI — se a IA mudar shape, o build quebra.
2. Implementações importam tipos *somente* de `contracts`; eslint
   `no-restricted-imports` impede módulos de importarem internals uns dos outros.
3. Prompts de implementação sempre citam o contrato: *"implemente
   `DatasetStore.commitVersion` conforme `packages/contracts/v1/dataset.ts`, sem
   alterar a interface"*.

## 6.4 Tamanho de tarefa por sessão

- 1 prompt = 1 função/classe + seus testes (as tasks `001`–`047` já estão nesse tamanho).
- 1 sessão = 1 invariante fechada, terminando com testes verdes + commit. **Nunca**
  termine sessão com teste vermelho "para continuar depois".
- Geração grande (scaffold, migration) → revise como PR de júnior. **Migrations SQL
  sempre revisadas linha a linha** — é o único lugar onde um erro da IA destrói dados.
- Ao começar cada release, abra com um prompt de contexto: cole o objetivo + critério
  de aceite da release e peça um plano de tasks antes de gerar código; compare com este
  roadmap.

---

# PARTE 7 — O QUE NÃO CONSTRUIR NOS PRIMEIROS 6 MESES

| Corte | Justificativa |
|---|---|
| Federation em tempo real (pushdown) | Copiar é simples e auditável; query planner federado é um projeto inteiro. Só com fonte que não pode ser copiada |
| Offline / conflict resolution / multi-replica (F5) | Parte academicamente mais difícil (cross-ACL convergence); zero necessidade no ano 1 |
| Edge / SCADA / IoT | Vertical específica; o Connector API já acomoda depois sem mudar o core |
| Multi-tenant | Dobra a superfície de segurança; single-tenant com `principal` já exercita o Policy API (mantenha a coluna `tenant_id` no schema) |
| Microsserviços, Kafka, Kubernetes | Custo operacional sem benefício na escala de 1 dev; outbox no Postgres preserva a semântica |
| DSL própria de transformação (parser/AST da F3) | SQL versionado + DuckDB entrega 95% do valor; DSL é otimização de UX |
| Workflow engine genérico com saga (F8 avançado) | R5 entrega Action de 1 passo com idempotência; multi-step com o 2º caso de uso real |
| Agentes autônomos com write (K/L) | R7 (read) → R8 (propose+approve) é o máximo responsável |
| ML de entity resolution (embeddings) | Regras + gold set chegam a F1 alto com chaves fortes (CNPJ, email); ML sem gold set grande vira false-merge factory |
| Mobile, geoespacial, UI elaborada | Não fecham loop nenhum; F9 prova-se com 1 app web funcional |
| Noninterference total (timing/cache side-channels) | R4 cobre o essencial (search/listagem/count); threat model completo é fase de hardening com pentest |

---

# PARTE 8 — RISCOS E DECISÕES A CONFIRMAR

1. **Volume real de dados** — acima de ~100M eventos/dia, revisitar DuckDB e outbox
   no Postgres antes da R2.
2. **Caso de uso offline real desde o dia 1?** — se sim, a F5 sai do corte e vira
   release dedicada (é o item mais caro da blueprint).
3. **Produto comercial?** — freedom-to-operate das patentes citadas é decisão
   jurídica (profissional de PI), não técnica. A regra da blueprint está correta:
   implementação independente, patentes como mapa de problemas.
4. **Design patents (D781869...D1083953)** — trilha separada de UX clean-room; não
   copiar aparência das interfaces Palantir. Não são requisitos de backend.
5. **Domínio do primeiro vertical slice** — escolha 2 fontes reais com chaves fortes
   (ex.: ERP + CRM com CNPJ/email) e 1 Action de negócio real para a R5. O slice só
   prova a arquitetura se os dados forem reais.

---

# APÊNDICE — MAPEAMENTO: FASES ORIGINAIS → ORDEM REVISADA

| Fase original | Destino | Mudança |
|---|---|---|
| F0 Platform/Apollo | M0 (R1), reduzida | Só build + 1 ambiente + observability; canary/rollback multi-ambiente → hardening |
| — (não existia) | **M0: IAM/SSO + secrets + event bus** | NOVO — gap crítico da blueprint |
| F1 Connect/Federation/Edge | R1 (snapshot+CDC+checkpoint) / M6 (federation, edge) | Dividida: essencial cedo, avançado adiado |
| F2 Immutable Store | R1 | Mantida; `policy_id`/`lineage_ref` como campos reservados |
| F3 Transformation | R2 | Mantida; sandbox e DSL própria adiados |
| F4 Lineage/Security | R4 (policy+audit) / R2 (lineage por versão) / M5 (hardening) | Dividida em três — a mudança mais importante |
| F5 Replication/Offline | M7 (depois de Search/Apps) | **Reordenada** — replica objetos/actions, não datasets |
| F6 Entity Resolution | R3, **junto com F7-lite** | Circularidade F6↔F7 resolvida construindo juntas |
| F7 Ontology | R3 (lite) → endurece em R4–R6 | Mantida como coração, nasce mínima |
| F8 Functions/Actions | R5 | Mantida; workflow genérico adiado |
| F9 Search/Applications | R6 | Mantida |
| F10 AIP/Agents | R7–R8 (degraus) | Mantida por último, em degraus de autonomia |
| F11 Closed-loop/Hardening | M9 | Mantida — validação sistêmica, não construção |

**Regra final (da sua própria blueprint, agora como princípio operacional):**
> patent → technical problem → invariant → independent architecture → **tests**.
> Nenhum engine é generalizado antes de ser usado pelo slice.
