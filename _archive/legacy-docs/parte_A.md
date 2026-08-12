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
