# GUIA DE CONSTRUÇÃO PASSO A PASSO — PATENTE POR ETAPA
## Cada passo diz: O QUE construir → QUAIS patentes servem para essa etapa → PARA QUE cada uma serve → GATE (como saber que terminou)
## Uso com o Cursor: "Execute o PASSO N do GUIA_PASSO_A_PASSO.md"

> **Postura do repo (dataset-first / kernel genérico):** provar a plataforma com **qualquer dataset** (vendas, contábil, máquina, CSV, Postgres — o domínio não importa).  
> Fluxo: ingestão → memória imutável → transform → qualidade → lineage/policy → ontologia → …  
> **Não** é app de fábrica, planejamento, forecasting nem vertical de negócio. Especialização na empresa só **depois** dos gates em datasets de teste, e sempre como app em cima do kernel.  
> Spec ativa = este arquivo + `packages/*`. Docs antigos em `_archive/legacy-docs/` (não seguir).  
> **Status:** Blocos **1–6 entregues** + **Passos 20–21** (ER + audit/canonical) + **milestone Object/Action `/api/v2`**.  
> **Em andamento:** consolidação/hardening (ver `docs/platform-consolidation-audit.md`) — uma fonte de verdade Objects/Links, Postgres CAS, auth, Actions transacionais.  
> Próximo roadmap clássico após gates de consolidação: **Passo 22** (gold set + revisão humana).

---

## MILESTONE — CONSOLIDAÇÃO / HARDENING (em andamento)
<!-- Não apaga o progresso anterior. Fecha gaps P0–P73 antes de novas features. -->
**Objetivo:** um ObjectRepository/LinkRepository canônico; projector/graph/API/actions sobre a mesma verdade; Postgres durável; Actions atômicas + outbox; auth Bearer + policy.
**Docs:** `docs/architecture.md` · `docs/platform-consolidation-audit.md` · `docs/openfoundry-adaptations.md`
**Gate parcial:** `pnpm --filter platform-api test` (one-truth + listOntologies + soft-delete revive)
**Gate rápido do kernel:** `pnpm gate:core` (typecheck + test + build do caminho crítico; CI completo continua no monorepo)

Durability checklist (DONE = implementation + wiring em `createPostgresPlatformContext` + tests + restart/concurrency gate quando aplicável):

| Item | Status | Gate |
|---|---|---|
| PgObjectRepository / PgLinkRepository | DONE | CAS + soft-delete revive (memory+PG schema) |
| PgOperationalEventStore | DONE | append → restart → list |
| PgActionExecutionStore | DONE | execute → restart → getExecution |
| PostgreSQL idempotency | DONE | concurrent same key → 1 execução; restart + replay não reexecuta |
| Actions transacionais (UnitOfWork) | DONE | falha no meio → ROLLBACK; sem estado parcial |
| Canonical outbox (`outbox_events`) | DONE | status machine PENDING→PROCESSING→RETRYING/DELIVERED/DEAD_LETTER/UNHANDLED; backoff+jitter; lease; HTTP fora da TX |
| Connector write-back (pedido + worker) | DONE | SqlMirror sink **ou** HttpConnector + `Idempotency-Key`; `writeback_executions`; ERP simulator + closed-loop E2E |
| PolicyEngine / authorize no ActionExecutor | DONE | production fail-closed: `authorizer` obrigatório; AuthorizeFn = `authorizer.authorize` (uma fonte p/ Actions+Reads) |
| Bearer / JWT HS256 | DONE | `TokenVerifier` HMAC; production exige `PLATFORM_JWT_SECRET`; token inválido → 401; IdentityProvider/JWKS = Phase D |
| schema_migrations runner | DONE | checksum SHA-256; rerun no-op; histórico editado falha; advisory lock |
| PgOntologyRegistry | DONE | create+commit → restart → get ontology/version |
| Durable PgAuditRepository | DONE | GENESIS/EVENT/COMMIT/REDACTED; restart verify; concurrent append; redact+reload |
| Object history na mesma tx | DONE | governed snapshot pós-mutação (delete = RETURNING *); asOf = mundo vigente; restart |
| Link integrity + cardinality concurrente | DONE | `pg_advisory_xact_lock` + `SELECT … FOR UPDATE` nos endpoints; WORLD NOW ignora pontas deletadas; history reconstrói |

Não avançar para AIP, search, replication, apps verticais ou `apps/contas-a-pagar` até estes gates.

---

## BLOCO 1 — FUNDAÇÃO (ENTREGUE)
<!-- ENTREGUE: Passos 1–4. Pacotes: common-build-system, dynamic-documentation, auto-logging-config, metrics-collection, observability, iam-auth-monitoring, security-config-secrets, event-bus, fair-query-scheduler, bounded-fair-scheduler (+ ldpc/psm de suporte). Gate: pnpm gate:bloco1 -->

### PASSO 1 — Monorepo + build reproduzível
<!-- ENTREGUE: packages/common-build-system + packages/dynamic-documentation; monorepo pnpm/turbo. -->
**Construir:** pnpm workspaces + Turborepo + TypeScript strict; mesmo commit → mesmo hash de artefato.
**Patentes desta etapa:**
- **US 10,001,982** — serve para: build system único compartilhado por todos os serviços (grafo de dependências → build → testes → scan → artefato → manifest assinado).
- **US 10,509,647** — serve para: documentação gerada dinamicamente do próprio código (OpenAPI dos schemas).
**Gate:** 2 builds do mesmo commit → mesmo hash. *(tasks 001–002)* — `pnpm cbs` / `pnpm docs`

### PASSO 2 — Observabilidade obrigatória
<!-- ENTREGUE: packages/observability + auto-logging-config + metrics-collection; Jaeger/Grafana via docker-compose. -->
**Construir:** pino + OpenTelemetry; todo log com `principal`, `trace_id`, versão, deployment_id, operação, duração, resultado; Jaeger + Grafana.
**Patentes:**
- **US 11,681,606** — serve para: configuração automática da infraestrutura de logging a partir do código.
- **US 11,870,666** — serve para: coleta e classificação de métricas de uso de deployments.
**Gate:** 100% das requisições com trace_id + actor + latência. *(task 015)* — `pnpm obs -- check`

### PASSO 3 — Identidade (IAM) + secrets
<!-- ENTREGUE: packages/iam-auth-monitoring + packages/security-config-secrets. -->
**Construir:** better-auth atrás de `IdentityProvider` interno; tabela `principals`; service accounts; SOPS+age para secrets; separação CODE/CONFIG/SECRETS/POLICY.
**Patentes:**
- **US 8,763,078** — serve para: monitoramento de tentativas de autenticação (métricas e alertas de auth).
- **EP4660856A2/A3** — serve para: gestão de segurança de software (scan de dependências no CI).
- **US20250298632A1** — serve para: configuração de ambientes computacionais separada do artefato.
**Gate:** login funciona; todo request carrega principal. *(tasks 003–006)* — `pnpm iam` / `pnpm sec`

### PASSO 4 — Event bus (outbox Postgres)
<!-- ENTREGUE: packages/event-bus + fair-query-scheduler + bounded-fair-scheduler. -->
**Construir:** tabela outbox transacional + LISTEN/NOTIFY + pg-boss (jobs com prioridade).
**Patentes:**
- **US 9,092,482 / US 9,715,526** — servem para: escalonamento justo de trabalho (fair scheduling entre jobs/tenants).
**Gate:** evento commitado na transação é entregue ao consumer; restart não perde job. *(tasks 007–008)* — `pnpm bus -- gate` / `pnpm fqs` / `pnpm bfs`

---

## BLOCO 2 — CONECTAR O MUNDO EXTERNO (ENTREGUE)
<!-- ENTREGUE: Passos 5–7. Core: contracts, connector-sdk, connector-postgres, schema-registry. Patentes de suporte: LCV/EAD/VRN/CSD + ITS/ECE/TIP. -->

### PASSO 5 — Connector SDK (a interface que tudo usa)
<!-- ENTREGUE: packages/contracts (Connector API) + packages/connector-sdk; patentes US 8.930.897 / 9.984.152 / 10.572.529 / 11.100.154 em LCV/EAD/VRN/CSD. -->
**Construir:** interface `discover / schema / snapshot / read(cursor) / checkpoint / health` + `capabilities[]`. Regra: connector NUNCA conhece a Ontology.
**Patentes:**
- **US 8,930,897** — serve para: transformar fontes externas para um object model associado a uma ontology e **validar o transformation script contra os parâmetros da ontology**.
- **US 9,984,152 / US 10,572,529 / US 11,100,154** — servem para: continuações dessa integração fonte→object model (variantes e melhorias do mesmo mecanismo).
**Gate:** nova fonte conecta via SDK sem alterar o core. *(tasks 009–010)* — `pnpm csdk -- demo`

### PASSO 6 — Envelope canônico + primeiro connector (Postgres)
<!-- ENTREGUE: CanonicalEvent em contracts; connector-postgres (gate T1.3; SqlClient injetável/memória). Tagging: ITS/ECE/TIP. -->
**Construir:** `CanonicalEvent` (event_id, source_system, source_object, source_primary_key, schema_version, occurred_at, ingested_at, connector_id, checkpoint, principal, **policy_tags**, payload_hash, payload) + connector Postgres com snapshot + polling `updated_at` + checkpoint persistente.
**Patentes:**
- **US 10,809,888 / US20140282121** — servem para: tagging de conteúdo externo (daí nascem os `policy_tags` no envelope).
- **US 10,552,524** — serve para: inline document tagging + sincronização de objetos (marcação no momento da ingestão).
**Gate:** T1.3 — matar no evento 10.000, reiniciar, continuar do checkpoint certo. *(tasks 011–013)* — `pnpm gate:t1.3`  
**Nota kernel:** adapter `pg` real fica para quando houver fonte Postgres de app; o gate usa SqlClient injetável.

### PASSO 7 — Schema Registry + classificador de drift
<!-- ENTREGUE: packages/schema-registry (registry + drift T1.4 + discover US 9,330,120). -->
**Construir:** registro de source/tabela/coluna/tipo/hints/keys/primeira e última observação + classificador: compatible / coercible / breaking / unknown.
**Patentes:**
- **US 9,330,120** — serve para: importação visual/assistida de dados — descoberta automática de schema de fontes novas.
**Gate:** T1.4 — adicionar/remover/alterar coluna → classificação correta e resposta adequada. *(tasks 014, 016)* — `pnpm sr -- demo`

---

## BLOCO 3 — MEMÓRIA IMUTÁVEL (ENTREGUE)
<!-- ENTREGUE: Passos 8–10. Pacotes: history-preserving-pipeline, delta-storage, multi-row-transactions (+ tipos em contracts). Storage default: memória/FS. MinIO/Postgres reais = upgrade futuro, não bloqueia o gate. -->

### PASSO 8 — Dataset Store imutável
<!-- ENTREGUE: contracts DatasetStore/CommitInput + packages/history-preserving-pipeline (hpp/ds). -->
**Construir:** Dataset → DatasetVersion 1..N; versão commitada é imutável; alteração = nova versão com parent_version; content-hash sha256; campos reservados `policy_id` e `lineage_ref`. (Parquet/MinIO + manifest Postgres = upgrade de storage; kernel valida em memória/FS.)
**Patentes:**
- **US 9,229,952** — serve para: pipeline que preserva histórico (cada estado reconstruível).
- **US 9,483,506** — serve para: continuação do history-preserving (variantes de armazenamento histórico).
- **US 9,946,738** — serve para: pipeline versionado/universal (input_versions[] + transformation_id por versão).
**Gate:** versão commitada rejeita mutação; duplicate commit → mesma versão. *(tasks 017–020)* — `pnpm hpp -- demo`

### PASSO 9 — Delta tree com compactação
<!-- ENTREGUE: contracts delta-tree + packages/delta-storage. -->
**Construir:** BASE + Δ1 + Δ2 + ... + Combined Δ1-10 + Combined Δ1-1000 (compactações intermediárias).
**Patentes:**
- **US 11,397,717** — serve para: armazenar deltas individuais E deltas combinados/hierárquicos para reconstruir estados eficientemente.
- **US 9,367,463 / US 9,652,291** — servem para: zero-copy/caching — leitura sem copiar dados desnecessariamente.
**Gate:** reconstrução byte-for-byte de qualquer versão; compactação não altera resultado. *(tasks 021–023)* — `pnpm delta -- demo`

### PASSO 10 — Time travel, diff, transações, replay
<!-- ENTREGUE: contracts TimeTravelStore + packages/multi-row-transactions (mrtx/tt). -->
**Construir:** `snapshot(dataset, timestamp)` determinístico, `diff(v1,v2)`, commit atômico multi-linha, `replay()`.
**Patentes:**
- **US 8,504,542** — serve para: transações multi-linha (commit atômico de várias linhas).
- **US 9,619,507** — serve para: protocolo de leitura transacional (leitura consistente durante commits).
**Gate:** "estado do dataset X às 14:37:22 de ontem" → resposta determinística; crash entre write e commit não corrompe; leitura durante commit é consistente. *(tasks 024–026)* — `pnpm mrtx -- demo`

---

## BLOCO 4 — TRANSFORMAÇÃO (ENTREGUE)
<!-- ENTREGUE: Passos 11–14. Pacotes: transformation-runner, incremental-pipeline-scheduler, data-quality, execution-sandbox. -->

### PASSO 11 — Transformation runner (SQL versionado, DuckDB)
<!-- ENTREGUE: contracts TransformProgram + packages/transformation-runner (xform/tr). Executor kernel = memória; SQL versionado dialeto DuckDB; binary DuckDB = upgrade. privateTable declarado no DSL (execução multi-programa = Passo 12). Sem GUI/ontology (Bloco 6). -->
**Construir:** transformações como SQL versionado executado no DuckDB sobre Parquet/Postgres; mesmo input → mesmo content-hash (sem NOW() sem seed).
**Patentes:**
- **US 9,576,015 / US 9,965,534** — servem para: DSL de transformações (filter/join/derive/validate/output como pipeline declarativo).
- **US20170068698A1** — serve para: aplicação relacionada à DSL.
- **US 9,922,108 / US 10,776,382** — servem para: mecanismos de transformação de dados.
**Gate:** determinismo comprovado por hash. *(tasks 027–030)* — `pnpm xform -- demo`

### PASSO 12 — DAG + scheduler incremental
<!-- ENTREGUE: contracts PipelineEdge/BuildJobSpec + packages/incremental-pipeline-scheduler (ips/dagsched). Sem SQL UI / workers Spark / RMI. -->
**Construir:** grafo de dependências derivado de inputs/outputs declarados; detecção de ciclo; novo commit → enfileira SÓ descendentes afetados.
**Patentes:**
- **US 11,314,698** — serve para: determinar dependências entre datasets e **iniciar builds automaticamente quando os inputs necessários ficam disponíveis**, sem esperar datasets irrelevantes.
**Gate:** mudar 1 input → reconstrói exata e somente os outputs dependentes. *(tasks 031–033)* — `pnpm ips -- demo`

### PASSO 13 — Data quality + regras + quarentena
<!-- ENTREGUE: contracts QualityRule/QuarantineRecord/CompositeDatasetDef + packages/data-quality (dq). Sem NLP query UI; US11314698 = Passo 12. -->
**Construir:** completeness, uniqueness, validity, consistency, freshness, drift por dataset; regras (condition/severity/action/scope/version/owner); linhas violadas → quarentena com motivo.
**Patentes:**
- **US 11,429,572** — serve para: limpeza de dados baseada em regras (rules-based cleaning).
- **US 9,542,446 / US 10,678,860** — servem para: datasets compostos (joins declarados como inputs múltiplos de uma transformação).
**Gate:** qualidade calculada pós-run; violação vai para quarentena com motivo. *(tasks 034–035)* — `pnpm dq -- demo`

### PASSO 14 — Sandbox de execução
<!-- ENTREGUE: contracts SandboxPolicy/AuditEvent + packages/execution-sandbox (sandbox/sbx). Host-API sandbox (FS/net/CPU); não isolamento OS/VM. Sem Swing IDE / template UI. -->
**Construir:** CPU/memória/timeout limitados, filesystem e rede restritos, identidade registrada, audit de execução.
**Patentes:**
- **US20250265045A1** — serve para: execução de código dentro de pipeline de processamento de dados.
**Gate:** tentativas de escape bloqueadas. *(task 036)* — `pnpm sandbox -- demo`

---

## BLOCO 5 — LINEAGE + SEGURANÇA (ENTREGUE)
<!-- ENTREGUE: Passos 15–16. Pacotes: data-lineage, policy-engine (+ contracts lineage/policy/audit). -->

### PASSO 15 — Lineage por versão (grafo dataset→transform→dataset)
<!-- ENTREGUE: contracts lineage + packages/data-lineage (lineage/dl). Grafo versão=nó / derivação=aresta; upstream/downstream; invalid+propagate; completude. Sem GUI / EPID (Passo 16) / lineage colunar (Passo 27). -->
**Construir:** toda pipeline_run grava `input_versions[] → output_version` + hash + duration; `upstream()/downstream()`; completude 100%.
**Patentes:**
- **US 9,996,595** — serve para: proveniência total como **grafo onde datasets/versions são nós e derivações são arestas**.
- **US 9,348,879** — serve para: proveniência de dados (variante da família).
- **US20140114907** — serve para: tracking de proveniência.
- **US20150012477** — serve para: data lineage.
- **US 10,027,551** — serve para: lineage (continuação da família).
**Gate:** 100% dos outputs produtivos apontam para seus inputs. *(tasks 037–039)* — `pnpm lineage -- demo`

### PASSO 16 — Policy engine `authorize()` + audit hash-chained
<!-- ENTREGUE: contracts policy/audit + packages/policy-engine (policy/authz). EPID node graph; authorize allow/deny/partial; secured read sem count; create admissions; audit hash chain + redact + tamper. Sem pods/K8s/ingress. -->
**Construir:** `authorize(principal, resource, operation, context) → allow/deny/partial`; enforcement em TODA leitura; audit com hash chain (cada entrada referencia o hash da anterior); security matrix em toda API (allowed/denied/partial).
**Patentes:**
- **US 10,432,469** — serve para: controle de acesso baseado em nós (permissão granular por recurso).
- **US 10,397,229** — serve para: permissões de criação de recursos.
- **US20150188715** — serve para: **audit log verificável e redigível** (detectar adulteração).
**Gate:** usuário sem permissão não vê objeto NEM o count; adulteração do audit é detectada. *(tasks 040–045)* — `pnpm policy -- demo`

---

## ▶ PRÓXIMO — PASSO 22

## BLOCO 6 — ONTOLOGY (ENTREGUE)

### PASSO 17 — Ontology Registry (ObjectType/PropertyType/LinkType versionados)
<!-- ENTREGUE: contracts ontology + packages/ontology-registry (onto). Versionamento imutável; SEMÂNTICA×CINÉTICA; rollback. Sem mapping/projetor (Passo 18) / GUI / domínio financeiro. -->
**Construir:** registry com versionamento (mudança = nova ontology_version, nunca update in-place); separação SEMÂNTICA (o que existe) × CINÉTICA (o que pode acontecer).
**Patentes:**
- **US 7,962,495** — serve para: ontologia dinâmica (fundação: camada lógica separada dos dados físicos).
- **US 8,489,623** — serve para: dynamic ontology (continuação).
- **US 8,856,153** — serve para: dynamic ontology (continuação).
- **US 9,201,920** — serve para: dynamic ontology (continuação).
- **US 9,589,014** — serve para: dynamic ontology (continuação).
- **US 10,872,067** — serve para: dynamic ontology (continuação).
- **US20100070426** — serve para: modelagem de objetos (Object/Property types).
- **US 9,229,966** — serve para: object modeling (continuação).
**Gate:** criar ObjectType, versionar, rollback de ontology. *(tasks 046–049)* — `pnpm onto -- demo`

### PASSO 18 — Mapping versionado + Projetor + Object API
<!-- ENTREGUE: contracts object-platform + packages/object-platform (obj). Mapping versionado; projetor→objects/history/provenance; Object API via authorize(). Sem GUI / multi-DB / NVK NLP / vector-clock completo. -->
**Construir:** mapping dataset→ObjectType (JSON declarativo, versionado); projetor (versão de dataset → upsert em objects + object_history append-only + provenance); Object API (`getObject(at?)/queryObjects/traverseLinks/getHistory/getProvenance`) — toda leitura via authorize().
**Patentes:**
- **US 8,930,897** — serve para: reorganizar fontes no object model; mapear propriedades físicas → propriedades de objetos; definir relacionamentos entre objetos (a mesma patente do Passo 5 — ela liga connector à ontology).
- **US 10,691,729** — serve para: plataforma de objetos (object platform).
- **EP3425537A1** — serve para: object platform (família europeia).
- **US 11,816,156** — serve para: índice/query sobre ontology.
- **US 12,561,339** — serve para: interface de query unificada sobre múltiplos bancos baseados em ontology.
**Gate:** operação funciona só pelas APIs, sem UI. *(tasks 050–055)* — `pnpm obj -- demo`

### PASSO 19 — Links + Knowledge Graph
<!-- ENTREGUE: contracts knowledge-graph + packages/knowledge-graph (kg). Multi-hop + integrity + migration + remote refs + CTE SQL. Sem GUI/LLM/TypeDB/domínio vertical. -->
**Construir:** links tipados materializados (FK cruzada entre fontes); `traverseLinks` com Postgres recursive CTE; grafo vivo Object→Link→Object.
**Patentes:**
- **US20250077899A1** — serve para: knowledge graph (grafo de conhecimento da plataforma).
- **US 9,378,526** — serve para: referências remotas entre objetos.
- **US 9,621,676** — serve para: remote object references (continuação).
- **US 9,906,623** — serve para: remote object references (continuação).
**Gate:** traversal multi-hop; integridade referencial; link migration em nova versão. *(tasks 056–058)* — `pnpm kg -- demo`

---

## BLOCO 7 — ENTITY RESOLUTION (quem é quem entre as fontes)

### PASSO 20 — Pipeline de ER: normalização → blocking → scoring
<!-- ENTREGUE: contracts entity-resolution + packages/entity-resolution (er). Normalize→block→score + soft clusters. Sem audit persistido / gold set / GUI (Passos 21–22). -->
**Construir:** normalização (lowercase, sem acentos, CNPJ só dígitos); blocking por chave exata + nome normalizado (nunca O(n²)); scoring por regras ponderadas com thresholds match/no-match/review.
**Patentes:**
- **US 8,554,719** — serve para: resolução de entidades (fundação da família).
- **US 9,501,552** — serve para: entity resolution (continuação).
- **US 9,846,731** — serve para: entity resolution (continuação).
- **US 12,229,154** — serve para: **Focused Probabilistic Entity Resolution** — P(same_entity | features).
- **US20140280252** — serve para: comparar/associar objetos.
**Gate:** "ACME LTDA" (A) + "Acme Ltda." (B) → 1 objeto Customer. *(tasks 059–063)* — `pnpm er -- demo`

### PASSO 21 — Auditoria de matches + canonical entities
<!-- ENTREGUE: packages/entity-resolution + contracts (audit/canonical/fingerprint/rank) + infra/sql/0006_entity_resolution.sql. Sem gold set / HTTP review queue (Passo 22). -->
**Construir:** persistir candidate, score, features, model_version, decision, reason, review, timestamp; merge para canonical sem destruir original; link source→canonical.
**Patentes:**
- **US20250165857A1** — serve para: **entity resolution generalizável baseada em estruturas da ontology** — comparar registros entrantes com entidades já presentes na ontology + usar feedback para melhorar (por isso ER e Ontology são construídas juntas).
- **US 12,393,406 / US20250348288A1** — servem para: busca de entidades via copy-detection.
- **US 8,788,405** — serve para: clusters de entidades.
- **US 8,818,892** — serve para: priorização de clusters (ordena a fila de revisão).
**Gate:** toda decisão auditável; false merge reversível. *(tasks 064–067)* — `pnpm er -- demo`

### PASSO 22 — Gold set + revisão humana
**Construir:** 50 pares rotulados (MATCH/NO_MATCH); métricas precision/recall/F1/**false-merge-rate**/false-split-rate/manual-review-rate; fila + endpoint de revisão para zona cinzenta.
**Patentes:**
- **US20250165857A1** — serve para: o feedback humano melhorando a resolução (a mesma do Passo 21 — fecha o loop de aprendizado).
**Gate:** métricas medidas; false merge rate documentado (contamina o grafo se alto). *(tasks 068–070)*

---

## BLOCO 8 — FUNCTIONS + ACTIONS (dados provocando mudança no mundo)

### PASSO 23 — Function registry
**Construir:** `f(objects) → result` — nunca altera estado (ex.: `scoreRecord`, `aggregateMetrics`, `deriveFlags`); versionada, testável, registrada.
**Patentes:** (camada cinética — definida pela separação semântico/cinético das Dynamic Ontology patents do Passo 17).
**Gate:** function pura, versionada, invocável via API. *(tasks 071–073)*

### PASSO 24 — Action engine (o momento mais importante)
<!-- MILESTONE: packages/action-engine + platform-api /api/v2 + ObjectRepository/LinkRepository + ObjectSet algebra. Domain-neutral test: Customer/SalesOrder/Product + approve-sales-order. -->
**Construir:** ActionDef (input_object_types, parameter_schema, preconditions, authorization_policy, validation, transaction, side_effects, postconditions, compensation, audit_requirements); pipeline FIXO: **authorize → validate → tx → write-back → audit**; `expectedObjectVersions` (optimistic concurrency); `idempotencyKey`; LLM/UI NUNCA escrevem direto.
**Patentes:**
- **US 8,429,194** — serve para: workflows sobre documentos/objetos (fundação da família de workflow).
- **US 8,905,597** — serve para: document workflow (continuação).
- **US 8,732,574** — serve para: parametrização de workflows.
- **US 9,058,315** — serve para: workflow parameterization/generation (continuação).
- **US 9,880,987** — serve para: workflow generation (continuação).
- **US 10,706,220** — serve para: workflow generation (continuação).
- **US 9,223,773** — serve para: geração de documentos a partir do modelo.
- **US20240386347A1 / EP4465217** — servem para: gestão de processos baseada em objetos (actions tipadas por ObjectType).
**Gate:** unauthorized → denied; duplicate (idempotencyKey) → 1 execução; stale object → conflict; audit completo. *(tasks 074–080)*

### PASSO 25 — Write-back (fechar o ciclo na fonte)
**Construir:** write-path no Connector SDK; Action escreve na fonte pelo connector; fonte muda → connector detecta → nova versão → ontology converge.
**Patentes:**
- **US 8,930,897** — serve para: a via de retorno — o object model sincronizado de volta com a fonte externa.
- **US 10,552,524** — serve para: object synchronization (sincronização de objetos com sistemas externos).
**Gate: O GATE DO PRODUTO** — ciclo observe→decide→act→write-back→novo estado visível no audit. *(tasks 081–085)*

### PASSO 26 — 2ª fonte + links cruzados + propagação de classificação
**Construir:** segundo connector; links entre objetos de fontes diferentes; classificação propaga via lineage (A confidencial → transform(A) herda → objeto herda).
**Patentes:**
- **US 10,146,960 / US 11,720,713** — servem para: ambientes colaborativos / acesso por classificação.
- **US 10,915,542** — serve para: restrições contextuais de compartilhamento.
- **EP4248349** — serve para: controle de acesso a data assets eletrônicos.
- **US 12,066,982** — serve para: compartilhamento de data assets.
- **US 12,353,582** — serve para: exploração/acesso a data assets.
- **US 12,619,785** — serve para: permissões por hierarquia de documentos.
**Gate:** propagação de classificação comprovada de ponta a ponta. *(tasks 086–092)*

---

## BLOCO 9 — SEGURANÇA COMPLETA (hardening)

### PASSO 27 — Lineage colunar + redaction de grafo
**Construir:** lineage até coluna/property; redaction: remove nós e propriedades não autorizados, repara arestas soltas, entrega grafo sanitizado.
**Patentes:**
- **US 9,501,761** — serve para: **colaboração com grafo redigido** (redacted graph) — a base da redaction.
- **US 9,857,960** — serve para: colaboração inter-entidades.
- **US 10,222,965** — serve para: colaboração (continuação).
- **US 11,327,641** — serve para: colaboração (continuação).
- **US 12,386,496** — serve para: colaboração (continuação).
- **US20250328230A1** — serve para: continuations da colaboração.
**Gate:** grafo sanitizado sem vazar e sem arestas quebradas. *(tasks 093–097)*

### PASSO 28 — Noninterference + fuzzing de autorização
**Construir:** usuário sem acesso não infere NADA por: count, erro diferente, autocomplete, índice, embeddings, cache, LLM, logs; fuzzer gerando principal × resource × action × context.
**Patentes:**
- **WO2022245989** — serve para: controle de ações/acesso de usuários.
- **US 10,044,745** — serve para: avaliação de risco de segurança de rede.
**Gate:** suite noninterference (8 canais) verde; fuzzing sem violação. *(tasks 098–105)*

---

## BLOCO 10 — SEARCH + APLICAÇÕES

### PASSO 29 — Índice permission-aware + Query API
**Construir:** Meilisearch com ACL no documento; Query API → Ontology Query Planner → Object Store / Search Index / Graph / Federation; segurança nas 6 superfícies (hit, autocomplete, facet, suggestion, snippet, ranking).
**Patentes:**
- **US 9,031,981** — serve para: Search Around (busca ao redor de um objeto).
- **US 9,798,768** — serve para: Search Around (continuação).
- **US 8,868,537** — serve para: search (fundação).
- **US 9,262,529** — serve para: busca web simples.
- **US 10,726,032** — serve para: templates de busca.
- **US 9,619,557** — serve para: caracterização por key-phrases.
- **US 8,041,714 / US 8,280,880** — servem para: filter chains (cadeias de filtros).
- **US 11,238,102** — serve para: busca em linguagem natural.
**Gate:** permission leakage = 0; index freshness medido; p95 no alvo. *(tasks 106–115)*

### PASSO 30 — APIs de exploração genéricas (SEM app de negócio)
<!-- ADIADO: 1ª app / UIs só depois dos gates em datasets de teste + pedido explícito. -->
**Construir (kernel):** queries de padrão no grafo; APIs de leitura de objetos/links; **não** entregar app vertical nem UI de negócio neste passo.
**Quando houver app:** entra em `apps/<nome>/` sobre a mesma Ontology — fora do core.
**Patentes (referência, usar sob demanda):**
- **US 8,799,240** e continuações — exploração em larga escala (capacidade de plataforma).
- **US 9,639,580 / US 9,280,532 / US 9,880,993** — visualização / rich objects (só se a app pedida exigir).
**Gate (kernel):** Query/API de objetos + grafo sem vazar permissão; **sem** app de negócio no core. *(tasks 116–125 — parte app suspensa)*

### PASSO 31 — Federation (quando houver fonte que não pode ser copiada)
**Construir:** federation planner → pushdown query → fonte → representação temporária → materialização opcional.
**Patentes:**
- **US 10,402,397** — serve para: federação de dados.
- **US 11,281,659** — serve para: **representações temporárias de dados federados** — acessar antes de materializar definitivamente.
- **US 11,681,690** — serve para: federation (continuação).
**Gate:** T1.5 — consultar registro remoto sem copiá-lo. *(tasks 126–130)*

### PASSO 32 — Fonte remota / edge (SOMENTE sob demanda explícita)
<!-- NÃO é o default. Só se houver fonte concreta que exija connector edge. -->
**Construir (se pedido):** connector via o mesmo SDK (`capabilities[]`) — eventos entram como `CanonicalEvent`.
**Patentes (opcionais):**
- **US 11,799,877 / US 12,261,861 / US20250233873A1** — integração edge (só com fonte real).
**Gate:** dados remotos entram pelo mesmo envelope canônico; **zero** camada de domínio no core. *(tasks 131–135)*

---

## BLOCO 11 — REPLICATION + OFFLINE (só com objetos/actions existindo)

### PASSO 33 — Replication protocol cross-ACL
**Construir:** mutation (mutation_id, source_replica, logical_clock, object, operation, payload, policy, timestamp, dependencies); vector checkpoints; convergência mesmo com evento parcialmente redigido; mudança de ACL = mutation.
**Patentes:**
- **US 8,886,601 / US 9,785,694** — servem para: replicação incremental.
- **US 9,330,157 / US 10,061,828** — servem para: replicação cross-ontology.
- **US 8,527,461 / US 8,782,004 / US 9,715,518 / US 10,089,345** — servem para: replicação cross-ACL (réplicas com permissões diferentes).
- **US 10,621,198** — serve para: replicação segura.
- **US 8,838,538** — serve para: mudanças de ACL durante replicação.
**Gate:** réplica sem permissão converge mesmo recebendo mudança redigida. *(tasks 136–143)*

### PASSO 34 — Offline + conflitos
**Construir:** snapshot autorizado local → disconnect → mutations locais → reconnect → conflict detector → resolution → estado convergido.
**Patentes:**
- **US 8,515,912 / US 9,569,070** — servem para: detecção e resolução de conflitos (deconfliction).
- **US 8,364,642 / US 8,812,444 / US 9,275,069** — servem para: investigações desconectadas (trabalho offline).
**Gate (invariante):** rede estabilizou → `authorized_state(A) == authorized_state(B)` na porção compartilhável; testado com partition + reorder + duplicate + drop + 3+ réplicas. *(tasks 144–150)*

---

## BLOCO 12 — AIP (IA sobre a Ontology, em 4 degraus)

### PASSO 35 — Degrau 1: AI Gateway + LLM read-only
**Construir:** User → AI Gateway → Identity+Context → Policy → Agent Runtime → Tool Registry (tool = wrapper de API autorizada: tool_id, input_schema, output_schema, required_permission, risk_level, timeout, rate_limit) → Result → Policy filtering → Response.
**Patentes:**
- **US 12,405,983** — serve para: **LLM operando sobre a Ontology** (grounding em objetos reais).
- **US20250278421A1 / US20250363154A1** — servem para: continuações LLM↔Ontology.
- **US20240419658A1** — serve para: Profile-Based AI (contexto por perfil de usuário).
- **EP4443310A1** — serve para: interfaces de usuário de sistemas de AI.
- **US20240403396A1** — serve para: **saída de LLM respeitando permissões** (output filtrado por policy).
- **US20240403103A1** — serve para: integração de modelos.
- **US20260017123A1** — serve para: assistente AI cross-application.
**Gate:** pergunta NL → resposta grounded citando objetos; trocar o LLM → nada quebra. *(tasks 151–158)*

### PASSO 36 — Degrau 2–4: agent→function → proposed action → authorized action
**Construir:** state-machine agent (START→UNDERSTAND→GATHER_DATA→ANALYZE→PROPOSE_ACTION→APPROVAL?→EXECUTE→VERIFY→DONE, cada estado com allowed_tools, prompt, transition_conditions, max_iterations, approval_policy); context builder (identity+role+permissions+object context+conversation+workflow state+tools+policies); high-risk gate: propose→simulate→validate→policy→human approval→execute→verify.
**Patentes:**
- **US20250110753A1 / EP4530883** — servem para: **agentes LLM apoiados em state machine** (não deixar agente crítico improvisar).
- **US20250110786A1** — serve para: operações de agentes (Agent Ops).
- **US20250384290A1 / EP4668176A1** — servem para: ML assistido por LLM + Ontology.
- **US20260065540A1** — serve para: visualizações multidimensionais controladas por NL.
- **US20260127387A1 / EP4738182A1** — servem para: seleção de exemplos few-shot.
**Gate:** agente propõe → humano aprova → executa pelo MESMO Action engine do Passo 24. *(tasks 159–166)*

### PASSO 37 — Evaluation framework + testes adversariais
**Construir:** suíte versionada (eval_case: input, context, allowed_tools, expected facts, expected action, forbidden actions, rubric, result, model_version, prompt_version, agent_version); métricas (task success, groundedness, tool-selection accuracy, permission violations, hallucination, latency, cost, human override); 11 adversariais obrigatórios.
**Patentes:**
- **US20250199932A1 / EP4571511A1** — servem para: **avaliação de agentes** (eval framework).
- **US20240420258A1** — serve para: avaliação de modelos.
- **US20250147832A1 / US 12,487,876 / US20260127063A1** — servem para: análise de erros assistida por LLM.
**Gate:** eval suite verde incluindo prompt injection, exfiltration, unauthorized tool, fake instructions em documento, poisoned search, stale context, conflicting facts, infinite loop, action duplication, tool timeout, model outage. *(tasks 167–172)*

---

## BLOCO 13 — FECHAMENTO (provar que o ciclo inteiro funciona)

### PASSO 38 — Teste E2E de 17 passos
**Construir/validar:** novo dado na fonte → connector detecta → evento persistido → nova versão → pipeline incremental → lineage registra → ER encontra entidade → ontology atualiza → function recalcula → workflow detecta condição → agent/usuário decide → action autorizada → write-back → fonte muda → connector recebe → ontology converge → **audit mostra todo o ciclo**.
**Gate:** as 17 etapas visíveis num único trace_id. *(tasks 173–175)*

### PASSO 39 — Chaos + DR + Load + Replay
**Construir/validar:** desligar connector/broker/storage/search/graph/action worker/LLM/API externa → degradação controlada; RPO/RTO + backup/restore; load por dimensão (events/sec, objects, relationships, users, queries/sec, actions/sec, agent tool calls/sec); replay de janela histórica → estado equivalente.
**Patentes:**
- **US 11,870,666** — serve para: métricas de uso sob carga (a mesma do Passo 2 — agora em escala).
**Gate:** plataforma reconstruída do zero = estado equivalente. *(tasks 176–180)*

---

## RESUMO DA ORDEM (colar na parede)

```
BLOCO 1  Fundação (build, logs, IAM, event bus)        → passos 1–4   ✓ ENTREGUE
BLOCO 2  Connect (SDK, envelope, schema registry)      → passos 5–7   ✓ ENTREGUE
BLOCO 3  Store imutável (versões, deltas, time travel) → passos 8–10  ✓ ENTREGUE
BLOCO 4  Transform (runner, DAG, qualidade, sandbox)   → passos 11–14  ✓ ENTREGUE
BLOCO 5  Lineage + Policy + Audit                      → passos 15–16  ✓ ENTREGUE
BLOCO 6  Ontology (registry, mapping, grafo)           → passos 17–19  ✓ ENTREGUE
BLOCO 7  Entity Resolution (ER + gold set)             → passos 20–22  ◀ Passos 20–21 ✓; 22 próximo
BLOCO 8  Functions + Actions + Write-back              → passos 23–26  ★ CICLO DA PLATAFORMA
BLOCO 9  Security hardening                            → passos 27–28
BLOCO 10 Search + APIs (+Federation; Edge só se pedido)→ passos 29–32
BLOCO 11 Replication + Offline                         → passos 33–34
BLOCO 12 AIP (4 degraus + evals)                       → passos 35–37
BLOCO 13 Closed-loop E2E + hardening                   → passos 38–39
```

**Dataset-first:** validar cada bloco com datasets de teste genéricos. App real da empresa (qualquer vertical) entra em `apps/<nome>/` **só depois** — nunca no core.

**Ordem obrigatória daqui pra frente:** Passo 22 (gold set / revisão humana) → demais.

**Não vira core (patentes verticais — ficam fora da fundação):**
US 9,129,219 / 9,836,694 (crime-risk) · US 9,501,202 (genomic) · US 9,431,507 (acoustic sensing) · US 9,872,083 / 10,708,669 (media/ads) · US 8,494,941 (financial similarity) · US 9,830,157 / 9,676,662 (image metadata) · US 9,606,647 (gestures) · US 11,706,090 (network troubleshooting).

**Design patents (aparência de UI, trilha separada):** D781869, D796550, D802000, D802016, D803246, D808991, D810101, D810760, D811424, D822705, D826269, D834039, D883301, D883997, D888082, D891471, D894199, D894944, D894958, D899447, D908714, D910047, D914032, D916757, D916789, D919645, D920345, D928807, D930010, D933674, D933675, D933676, D934290, D941318, D946615, D953345, D957409, D963692, D977494, D1083953.
