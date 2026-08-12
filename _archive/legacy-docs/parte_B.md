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
