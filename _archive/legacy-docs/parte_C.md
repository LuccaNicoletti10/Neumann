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
