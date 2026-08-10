# PLATAFORMA OPERACIONAL — README MESTRE DE IMPLEMENTAÇÃO
### Projeto: plataforma de dados estilo Palantir (Ontology + Actions + AIP)
### Este arquivo é o MAPA DO PROJETO. Ele diz o que construir, em que ordem, por quê,
### qual patente inspira cada parte (funcionalmente) e como saber que cada fase terminou.

---

## 0. COMO USAR ESTE README (você + Cursor)

- **Você** acompanha o progresso aqui: marque `[x]` nas tasks concluídas.
- **O Cursor/agente** lê este README + `.cursor/rules/` + `docs/referencia/` antes de qualquer código.
- **Detalhe completo** de cada marco (modelos de dados, testes, tasks 001–180): `docs/referencia/TUDO_EM_UM.md`.
- **Regra de ouro:** 1 task por vez → testes verdes → commit → próxima. Nunca pular fase.

**O produto é este loop:**
```
SOURCE → CONNECT → VERSION → TRANSFORM → LINEAGE → RESOLVE → ONTOLOGY
→ FUNCTION → DECISION → ACTION → WRITE-BACK → (fonte muda) → novo evento
```

**A rota (decorar):**
```
M0 Fundação+IAM → M1 Ingest+Store → M2 Transform+Policy → M3 ER+Ontology → M4 Loop operacional
→ M5 Security hardening → M6 Search/Apps → M7 Replication → M8 AIP → M9 Closed-loop
```
> Chegando no **M4** o produto já funciona ponta a ponta. M5–M9 são evolução/hardening.

---

## 1. REGRA DAS PATENTES (ler antes de tudo)

As patentes citadas são **documentos públicos que ensinam quais problemas a Palantir
precisou resolver**. Nós as usamos assim:

```
PATENTE → problema técnico que ela resolve → invariante/comportamento que queremos
→ NOSSO design independente → testes que provam o comportamento
```

- ✅ **Copiamos:** o problema, o comportamento observável, os invariantes, os testes.
- ❌ **NÃO copiamos:** o mecanismo exato dos claims, código, arquitetura interna, aparência de UI.
- ⚖️ Várias famílias estão ativas/pending (ex.: US 12,405,983 ativa; US20250165857 pending).
  Para produto comercial: análise de freedom-to-operate com profissional de PI.
- 🎨 Design patents (D781869–D1083953): trilha separada de UX clean-room. Não são backend.

Em cada marco abaixo, a tabela de patentes mostra: **o que ela ensina → o que construímos**.

---

## 2. FASES DE IMPLEMENTAÇÃO (o que construir 1º, 2º, 3º...)

---

### 🔵 M0 — FUNDAÇÃO MÍNIMA + IDENTIDADE · *construir PRIMEIRO* · tasks 001–012

**Por que primeiro:** todo evento/log da plataforma carrega `principal` e `policy_tags`
desde o dia 1. Identidade é a única coisa que **não pode ser adicionada depois** sem
reescrever tudo. Escopo deliberadamente pequeno (nada de canary/multi-ambiente ainda).

**O que construir:**
| Componente | O que é |
|---|---|
| Monorepo | pnpm workspaces + Turborepo + TypeScript strict |
| Ambiente local | docker compose: Postgres 16, MinIO, Jaeger, Grafana |
| Identidade (IAM) | better-auth atrás de `IdentityProvider` interno; tabela `principals`; service accounts |
| Secrets | SOPS+age; NUNCA segredo no código/artefato |
| Event bus | Postgres outbox + LISTEN/NOTIFY + pg-boss (jobs) |
| Observabilidade | pino + OpenTelemetry; todo log com `principal`, `trace_id`, operação, duração, resultado |
| Build reproduzível | mesmo commit + mesmas deps → mesmo hash |

**Patentes desta fase (o que ensinam → o que fazemos):**
| Patente | Ensina | Construímos (independente) |
|---|---|---|
| US 10,001,982 — Common Build System | Build único reproduzível p/ todos os serviços | Monorepo com pipeline Turborepo + lockfile + hash de artefato |
| US 10,509,647 — Dynamic Documentation | Docs geradas do próprio sistema | OpenAPI gerado dos schemas Zod |
| US 11,681,606 — Auto Logging Config | Logging configurável a partir do código | Middleware pino único, campos obrigatórios |
| US 11,870,666 — Software Usage Metrics | Métricas de uso de deployments | OTel metrics + Prometheus |
| EP4660856A2 — Managing Software Security | Gestão de segurança de software | Scan de deps no CI |
| US20250298632A1 — Config de ambientes | Config separada de código | CODE/CONFIG/SECRETS/POLICY separados |

**Gate de saída (só avança quando):**
- [ ] `docker compose up` sobe tudo com 1 comando
- [ ] login funciona e todo request loga `principal` + `trace_id`
- [ ] build reproduzível comprovado (2 builds → mesmo hash)
- [ ] outbox: evento publicado em transação é entregue ao consumer

---

### 🔵 M1 — INGESTÃO + STORE IMUTÁVEL · *construir SEGUNDO* · tasks 013–035

**Por que segundo:** é a primeira propriedade demonstrável — "dado entra, história é
reproduzível". Sem isso não existe o que transformar, resolver ou mapear.
**Não construir aqui:** federation/pushdown e edge/SCADA (→ M6). Só snapshot + incremental.

**O que construir:**
| Componente | O que é |
|---|---|
| Connector SDK | Interface: `discover/schema/snapshot/read(cursor)/checkpoint/health` + `capabilities[]` |
| Connector Postgres | snapshot + polling por `updated_at` + checkpoint persistente |
| Envelope canônico | Todo dado entra como `CanonicalEvent` (event_id, source, principal, policy_tags, payload_hash...) |
| Schema Registry | schema físico + hints + primeira/última observação + classificador de drift (compatible/coercible/breaking) |
| Dataset Store | versões imutáveis em Parquet/MinIO, manifest no Postgres, content-hash sha256 |
| Time travel | `snapshot(dataset, timestamp)` determinístico; `diff(v1,v2)` |
| Delta tree | deltas + compactações intermediárias (BASE + Δ + combined) |
| Campos reservados | `policy_id` e `lineage_ref` no version record desde já |

**Patentes:**
| Patente | Ensina | Construímos |
|---|---|---|
| US 8,930,897 (+cont. 9,984,152 / 10,572,529 / 11,100,154) | Transformar fontes externas p/ object model; validar script contra schema | Connector SDK validando envelope contra Schema Registry |
| US 10,402,397 / 11,281,659 / 11,681,690 — Federation | Acessar dado remoto sem copiar tudo | **→ M6** (preparado via `capabilities[]`) |
| US 9,330,120 — Visual Data Importer | Importação assistida | descoberta automática de schema (`discover()`) |
| US 10,809,888 / 10,552,524 — Tagging | Marcar conteúdo externo | `policy_tags` no envelope |
| US 11,799,877 / 12,261,861 / US20250233873A1 — SCADA/Edge | Ingestão do mundo físico | **→ M6** (Connector SDK já acomoda) |
| US 9,229,952 / 9,483,506 — History Preserving Pipeline | Histórico V1→V2→V3 reproduzível | DatasetStore imutável + time travel |
| US 9,946,738 — Versioned Pipeline | Pipeline universal versionado | version_id + parent_version + input_versions[] |
| US 11,397,717 — Data Storage Deltas | Deltas individuais + combinados | Delta tree com compactação |
| US 8,504,542 / 9,619,507 — Transações | Commit atômico multi-linha | Transação Postgres + outbox |
| US 9,367,463 / 9,652,291 — Zero-copy/caching | Leitura sem cópia | content-addressable storage |
| US 9,092,482 / 9,715,526 — Fair scheduling | Escalonamento justo | filas pg-boss com prioridade |

**Gate:** "Qual o estado do dataset X às 14:37:22 de ontem?" → resposta determinística.
- [ ] T1.1 snapshot 2× → resultado idêntico
- [ ] T1.2 insert/update/delete → exatamente 1× no estado final
- [ ] T1.3 matar no evento 10.000 → reinicia do checkpoint certo
- [ ] T1.4 drift de coluna → classificado corretamente
- [ ] T1.6 backpressure 10× → sem perda
- [ ] T1.7 usuário sem acesso à fonte → não obtém o dado via connector
- [ ] Reconstrução byte-for-byte; crash entre write e commit; duplicate commit; replay completo

---

### 🔵 M2 — TRANSFORMAÇÃO + SECURITY MÍNIMA · *construir TERCEIRO* · tasks 036–060

**Por que terceiro:** o recompute incremental exige o versionamento do M1; e o policy
engine precisa existir **antes** de dados sensíveis fluírem pelas transformações
(retrofit de segurança é o pior cenário).

**O que construir:**
| Componente | O que é |
|---|---|
| Transformation runner | SQL versionado executado no DuckDB (lê Parquet/Postgres) |
| DAG de dependências | derivado dos inputs/outputs declarados; detecção de ciclo |
| Scheduler incremental | novo commit → enfileira SÓ descendentes afetados |
| Lineage por versão | toda run grava `input_versions[] → output_version` + hash |
| Data quality | completeness, uniqueness, validity, freshness, drift |
| Quarentena | linhas que violam regras → tabela com motivo |
| Sandbox básico | CPU/memória/timeout limitados, sem rede, identidade registrada |
| **PolicyEngine** | `authorize(principal, resource, operation, context) → allow/deny/partial` |
| **Audit log** | hash-chained (cada entrada referencia o hash da anterior) |
| Security matrix | toda API testada: allowed / denied / partially allowed |

**Patentes:**
| Patente | Ensina | Construímos |
|---|---|---|
| US 9,576,015 / 9,965,534 / US20170068698A1 — DSL | Linguagem de transformações | SQL versionado (DSL própria = corte, → só se necessário) |
| US 11,314,698 — Dynamic Pipeline Processing | Build automático quando inputs ficam prontos | Scheduler incremental sobre o DAG |
| US 11,429,572 — Rules-Based Cleaning | Limpeza por regras | Rule engine + quarentena |
| US 9,542,446 / 10,678,860 — Composite Datasets | Datasets compostos | joins declarados como inputs múltiplos |
| US 9,922,108 / 10,776,382 | Transformação de dados | runner DuckDB |
| US20250265045A1 — Code Execution Pipeline | Execução de código em pipeline | sandbox básico |
| US 9,996,595 / 9,348,879 / US20140114907 / US20150012477 / 10,027,551 — Provenance/Lineage | Proveniência como grafo (dataset=nó, derivação=aresta) | `lineage_edges` por versão; colunar → M5 |
| US 10,432,469 — Node-Based Access Control | Controle de acesso por nó | PolicyEngine com resource granular |
| US 10,397,229 — Resource-creation permissions | Permissão de criação de recursos | policy de create no registry |
| US20150188715 — Verifiable Audit Log | Audit verificável/redigível | hash chain + verificação |
| US 8,763,078 — Auth monitoring | Monitorar tentativas de autenticação | métricas/alertas de auth |

**Gate:** mudar 1 input → reconstrói exata e somente os outputs dependentes.
- [ ] Parser/plano determinístico: mesmo input → mesmo content-hash
- [ ] Incremental recompute correto; ciclo no DAG detectado
- [ ] 100% dos outputs produtivos apontam para seus inputs (lineage completeness)
- [ ] `authorize()` no caminho de TODA leitura das APIs de dataset/transform
- [ ] Audit hash chain verificável; adulteração detectada
- [ ] Sandbox: escape attempts bloqueados

---

### 🔵 M3 — ENTITY RESOLUTION + ONTOLOGY (juntas) · *construir QUARTO* · tasks 061–080

**Por que quarto e por que JUNTAS:** ER sem Ontology resolve "contra o nada"; Ontology
sem ER materializa duplicatas. A própria patente US20250165857 descreve ER **contra
entidades já presentes numa ontology** — é um loop de convergência, não uma sequência.
Este é o **coração do produto**: primeiro valor de negócio visível.

**O que construir:**
| Componente | O que é |
|---|---|
| Ontology Registry | ObjectType, PropertyType, LinkType, OntologyVersion (mudança = nova versão, nunca update in-place) |
| Mapping versionado | dataset → ObjectType (JSON declarativo coluna → property) |
| Projetor | versão de dataset → upsert em `objects` + `object_history` append-only + provenance |
| Object API | `getObject(at?)/queryObjects/traverseLinks/getHistory/getProvenance` — sempre via authorize() |
| ER — normalização | lowercase, sem acentos, CNPJ só dígitos |
| ER — blocking | candidatos por chave exata + nome normalizado (SQL, nunca O(n²)) |
| ER — scoring | regras ponderadas + thresholds match/no-match/review |
| ER — auditoria | persiste candidate, score, features, rule_version, decision, reason |
| Canonical entities | merge sem destruir original; link source→canonical |
| Gold set | 50 pares rotulados à mão + precision/recall/**false-merge-rate** |
| Revisão humana | fila + endpoint para zona cinzenta |

**Separação essencial (da F7 original):**
- **Semântica** (Object/Property/Link) = o que existe
- **Cinética** (Function/Action/Workflow) = o que pode acontecer (→ M4)

**Patentes:**
| Patente | Ensina | Construímos |
|---|---|---|
| US 7,962,495 / 8,489,623 / 8,856,153 / 9,201,920 / 9,589,014 / 10,872,067 — Dynamic Ontology | Camada lógica separada dos dados físicos, evoluindo por versões | Ontology Registry versionado |
| US20100070426 / 9,229,966 — Object Modeling | Modelagem de objetos/propriedades | ObjectType/PropertyType |
| US 10,691,729 / EP3425537A1 — Object Platform | Plataforma de objetos operacional | ObjectService |
| US20250077899A1 — Knowledge Graph | Grafo operacional vivo | links materializados + traverseLinks (Postgres recursive CTE) |
| US 9,378,526 / 9,621,676 / 9,906,623 — Remote object refs | Referências entre objetos | links tipados |
| US 9,280,532 / 9,880,993 — Rich objects | Objetos ricos em apps | → M6 (apps) |
| US 11,816,156 / 12,561,339 — Ontology query | Query unificada sobre ontologies | ObjectQuery (v1; unificada → M6) |
| US 8,554,719 / 9,501,552 / 9,846,731 / 12,229,154 — Entity Resolution | Resolução probabilística de identidade | ER por regras (ML = corte explícito) |
| US20250165857A1 — ER baseado em Ontology | Resolver contra a ontology + feedback | ER integrado ao ObjectService + revisão humana |
| US 12,393,406 / US20250348288A1 / US20140280252 / 8,788,405 / 8,818,892 | Clusters, comparação, priorização | blocking + fila de revisão ordenada por score |

**Gate:** "ACME LTDA" (fonte A) + "Acme Ltda." (fonte B) → 1 objeto `Customer` com provenance.
- [ ] Gold set: precision/recall/F1 medidos; **false merge rate documentado**
- [ ] Toda decisão de match tem score + features + reason persistidos
- [ ] getProvenance navega objeto → dataset_version → evento fonte
- [ ] Renomear property → nova ontology_version; leitura histórica; integridade de links
- [ ] Desligar a UI: operação funciona só pelas APIs da Ontology

---

### 🔵 M4 — LOOP OPERACIONAL: POLICY NÚCLEO + ACTIONS · *construir QUINTO* · tasks 081–105

**Por que quinto:** aqui a plataforma executa pela primeira vez
observe → decide → age → write-back. **É o produto.** R4 (policy/audit enforcement) e
R5 (function+action+write-back) entregam juntas o vertical slice completo.

**O que construir (R4 — Policy núcleo + 2ª fonte):**
| Componente | O que é |
|---|---|
| Enforcement total | nenhum módulo lê storage sem authorize(); roles/groups |
| Propagação de classificação | dataset confidencial → transform herda → objeto herda (via lineage) |
| 2º connector + links | segunda fonte real; links cruzados entre objetos |
| Índice permission-aware (lite) | listagem/busca de objetos filtrada por policy — nem o COUNT vaza |

**O que construir (R5 — Function + Action + Write-back):**
| Componente | O que é |
|---|---|
| Function registry | `f(objects) → result` — nunca altera estado (calculateRisk, forecastDemand...) |
| Action engine | pipeline FIXO: authorize → validate → tx → **write-back via connector** → audit |
| Optimistic concurrency | `expectedObjectVersions`; divergiu → retorna conflito, nunca sobrescreve |
| Idempotency | `idempotencyKey` obrigatório em action externa; retry ≠ execução duplicada |
| Write-back | Action escreve na fonte **pelo Connector** (write-path do SDK) — fecha o ciclo |
| Busca permission-aware | queryObjects + filtros, tudo via PolicyEngine |

**Patentes:**
| Patente | Ensina | Construímos |
|---|---|---|
| US 8,429,194 / 8,905,597 — Workflow | Workflows sobre documentos/objetos | Action de 1 passo (workflow genérico = corte → 2º caso real) |
| US 8,732,574 / 9,058,315 / 9,880,987 / 10,706,220 | Parametrização/geração de workflows | ActionDef declarativa (parameterSchema, pre/postconditions) |
| US 9,223,773 — Document generation | Geração de documentos | → só se houver caso de uso |
| US20240386347A1 / EP4465217 — Object-based process mgmt | Processos sobre objetos | Actions tipadas por ObjectType |
| US20260017035A1 — Interactive workflow analysis | Análise interativa de workflow | → M6 (apps) |
| US 9,031,981 / 9,798,768 — Search Around | Busca ao redor de um objeto | traverseLinks + busca lite |
| (F4 núcleo, já mapeadas no M2) | Policy/Audit | enforcement total agora |

**Gate (o mais importante do projeto):** executar `ReclassifyCustomer` na tela →
write-back muda a fonte → connector detecta → nova versão commita → ontology atualiza →
audit mostra o ciclo inteiro.
- [ ] Unauthorized action → denied com policyReason
- [ ] Duplicate action (mesmo idempotencyKey) → 1 execução
- [ ] Stale object (versão divergente) → conflict
- [ ] Falha externa parcial → estratégia retry/compensate/manual registrada
- [ ] Audit trail completo: actor, action, old_state, new_state, reason, request_id

---

### ⚪ M5 — SECURITY HARDENING · track pós-R5 · tasks 106–120

**Por que aqui:** endurecer propagação só faz sentido com transforms/objetos/actions
reais propagando dados.

**O que construir:** lineage **colunar** · propagação de classificação completa
(inclusive p/ outputs de LLM depois) · redaction de grafo (remove nós/propriedades não
autorizados + repara arestas) · **noninterference** (sem vazar por count, erro
diferente, autocomplete, cache, logs) · authorization **fuzzing** (principal × resource
× action × context) · pentest.

**Patentes:** US 10,146,960 / 11,720,713 (collaboration/classification) · US 10,915,542
(contextual sharing) · EP4248349 · WO2022245989 · US 12,066,982 · US 12,353,582 ·
US 12,619,785 (document hierarchy) · US 9,857,960 / 10,222,965 / 11,327,641 / 12,386,496
/ US20250328230A1 (collaboration) · US20240403396A1 (permission propagation p/ LLM) ·
US 10,044,745 (network-security risk).

**Gate:** suite noninterference completa em 8 canais; fuzzing sem violação.

---

### ⚪ M6 — ESCALA DE ACESSO: SEARCH + APPS (+FEDERATION) · R6 · tasks 121–140

**Por que aqui:** search em escala só se prova com volume real; federation só se paga
com fonte que não pode ser copiada.

**O que construir:** Query API unificada → Ontology Query Planner → Object Store /
Search Index (Meilisearch) / Graph / Federation · índice permission-aware nas **6
superfícies** (hit, autocomplete, facet, suggestion, snippet, ranking) · 1ª app
operacional (object explorer + visão grafo) · **2 UIs diferentes sem duplicar lógica** ·
federation planner/pushdown (condicional) · edge/SCADA (condicional).

**Patentes:** US 8,799,240 / 9,201,159 / 9,639,578 / 9,852,144 / 10,423,582
(investigation) · US 8,868,537 / 9,262,529 / 10,726,032 / 9,619,557 (search) ·
US 8,041,714 / 8,280,880 (filter chains) · US 11,238,102 (NL) · US 9,639,580
(data-mgmt viz) · US 9,727,376 / 10,037,314 / 10,997,363 / 11,494,549 / 9,380,431
(mobile/teams) · US 10,270,727 / 8,085,268 / 9,041,708 (geo — condicional) ·
US 8,484,115 / 9,378,524 / 8,034,971 / 8,326,727 / 8,484,549 / 9,727,981 (analytics
especializadas — só se necessário) + federation: US 10,402,397 / 11,281,659 / 11,681,690.

**Gate:** 2 interfaces completamente diferentes sobre a mesma Ontology, zero lógica
duplicada; permission leakage = 0; p95 dentro do alvo.

---

### ⚪ M7 — DISTRIBUIÇÃO: REPLICATION + OFFLINE · track dedicada · tasks 141–155

**Por que só agora (erro corrigido da ordem original):** replication replica **mutações
de objetos e actions** — que só existem desde M3/M4. Construir antes seria projetar o
protocolo contra a abstração errada e reescrevê-lo.

**O que construir:** replication protocol (`mutation_id, source_replica, logical_clock,
object, operation, payload, policy, dependencies`) · vector checkpoints · **cross-ACL**:
convergir mesmo recebendo evento parcialmente redigido · mudança de ACL = mutation ·
offline: snapshot autorizado local → mutations locais → reconnect → conflict detector →
resolution · invariante: `authorized_state(A) == authorized_state(B)` na porção
compartilhável.

**Patentes:** US 8,886,601 / 9,785,694 (incremental replication) · US 9,330,157 /
10,061,828 (cross-ontology) · US 8,527,461 / 8,782,004 / 9,715,518 / 10,089,345
(cross-ACL) · US 10,621,198 (secure replication) · US 8,838,538 (ACL changes) ·
US 8,515,912 / 9,569,070 (deconfliction) · US 8,364,642 / 8,812,444 / 9,275,069
(disconnected investigations) · US 9,501,761 (redacted graph collaboration).

**Gate:** network partition + reorder + duplicate + drop + ACL change durante partição
→ convergência eventual comprovada com 3+ réplicas.

---

### ⚪ M8 — AIP EM 4 DEGRAUS · R7–R8 · tasks 156–172

**Por que por último:** AIP é **consumidor** da plataforma. Cada degrau de autonomia
exige o anterior provado.

| Degrau | O que é | Release |
|---|---|---|
| 1. LLM read-only | AI Gateway → Identity+Context → Policy → Agent Runtime → Tool Registry → Ontology/Search | R7 |
| 2. Agent → Function | agente invoca Functions autorizadas | R7 |
| 3. Agent → proposed Action | propõe action; state-machine: START→UNDERSTAND→GATHER→ANALYZE→PROPOSE→APPROVAL→EXECUTE→VERIFY→DONE | R8 |
| 4. Authorized Action | humano aprova na UI → executa pelo MESMO Action engine do M4 | R8 |

**Regras duras:** LLM nunca recebe credenciais · tool = wrapper de API autorizada
(`tool_id, input_schema, output_schema, required_permission, risk_level, timeout,
rate_limit`) · autoridade permanece em Policy/Action/Ontology · **eval framework
versionado desde o degrau 1** · autonomia sem humano = decisão de negócio, não release.

**Patentes:** US 12,405,983 / US20250278421A1 / US20250363154A1 (LLM↔Ontology) ·
US20240419658A1 (Profile AI) · EP4443310A1 (AI UI) · US20250199932A1 / EP4571511A1
(Agent Evaluation) · US20250110786A1 (Agent Ops) · US20250110753A1 / EP4530883
(state-machine agents) · US20240403103A1 / US20240420258A1 (model integration/eval) ·
US20240403396A1 (permission-aware LLM output) · US20250147832A1 / US 12,487,876 /
US20260127063A1 (error analysis) · US20250384290A1 / EP4668176A1 (LLM+Ontology ML) ·
US20260017123A1 (cross-app assistant) · US20260065540A1 (NL visualizations) ·
US20260127387A1 / EP4738182A1 (few-shot).

**Gate:** trocar o modelo LLM → Ontology, Actions, permissions e workflows continuam
funcionando. (Se quebrar, você fez um chatbot, não uma plataforma.)
- [ ] 11 testes adversariais: prompt injection, exfiltration, unauthorized tool, fake
  instructions em documento, poisoned search, stale context, conflicting facts,
  infinite loop, action duplication, tool timeout, model outage

---

### ⚪ M9 — CLOSED-LOOP + HARDENING SISTÊMICO · pós-R8 · tasks 173–180

**O que construir/validar:**
- [ ] **Teste E2E de 17 passos:** dado novo na fonte → connector → evento → versão →
  pipeline incremental → lineage → ER → ontology → function → workflow → decisão →
  action autorizada → write-back → fonte muda → connector recebe → ontology converge →
  audit mostra tudo
- [ ] Chaos: desligar connector, broker, storage, search, graph, action worker, LLM,
  API externa → degradação controlada
- [ ] DR: RPO/RTO definidos, backup/restore testado
- [ ] Load: events/sec, objects, relationships, users, queries/sec, actions/sec
- [ ] Replay: reconstruir a plataforma do zero de uma janela histórica → estado equivalente

---

## 3. DEFINITION OF DONE DA PLATAFORMA (os 16 itens)

O projeto só está completo quando TODOS coexistirem:

1. [ ] Integra sistemas sem substituí-los
2. [ ] Dados/versionamentos históricos reproduzíveis
3. [ ] Transformações incrementais
4. [ ] Lineage completo
5. [ ] Autorização de ponta a ponta
6. [ ] Identidades reconciliadas entre fontes
7. [ ] Dados físicos → objetos semânticos
8. [ ] Objetos relacionados em operational graph
9. [ ] Functions sobre o modelo
10. [ ] Actions que alteram o mundo externo
11. [ ] Auditabilidade dessas mudanças
12. [ ] Apps diferentes sobre o mesmo modelo
13. [ ] LLMs consultam a Ontology sem acesso irrestrito
14. [ ] Agentes invocam só ferramentas permitidas
15. [ ] Agentes avaliados automaticamente
16. [ ] **Action executa → consequência observada → Ontology atualiza (o fechamento)**

---

## 4. O QUE NÃO VIRA CORE (não construir como fundação)

Patentes de aplicações verticais — são exemplos do que dá para construir EM CIMA da
plataforma, não requisitos dela: US 9,129,219 / 9,836,694 (crime-risk) · US 9,501,202
(genomic) · US 9,431,507 (acoustic sensing) · US 9,872,083 / 10,708,669 (media/ads) ·
US 8,494,941 (financial similarity) · US 9,830,157 / 9,676,662 (image/event metadata) ·
US 9,606,647 (gestures) · US 11,706,090 (network troubleshooting).

## 5. ÍNDICE DO REPO

```
.cursor/rules/          ← leis dos agentes (ler .cursor/rules/README primeiro)
docs/adr/               ← decisões de arquitetura (uma por mudança grande)
docs/referencia/        ← blueprint completa (TUDO_EM_UM.md = detalhe de cada task)
migrations/             ← SQL numerado, revisado linha a linha
packages/contracts/     ← contratos v1/ — INTANGÍVEL sem ADR
```
