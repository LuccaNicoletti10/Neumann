# CONTEXTO COMPARTILHADO — Blueprint Técnica Definitiva (usar em todas as partes)

## Premissas fixas (não alterar)

1. **A numeração F0–F11 da blueprint original vira domínios de engenharia**, não gates
   sequenciais. O plano oficial são os marcos M0–M9 (ordem corrigida).
2. **Regra de ouro:** nenhum engine é generalizado antes de ser usado pelo slice.
3. **Regra das patentes:** patent → technical problem → invariant → independent
   architecture → tests. Nunca copiar mecanismo de claim; implementação independente.
4. **Gates/testes da blueprint original (T0.1, T1.1... T1.7, gates de fase) são
   preservados** e mapeados para o marco correto.
5. Linguagem: PT-BR. Formato: markdown técnico.

## Ordem corrigida (oficial)

| Marco | Cobre (fases originais) | Release | Por que nesta posição |
|---|---|---|---|
| M0 Fundação mínima + IAM | F0 reduzida + NOVO: identidade/secrets/event bus | R1 | principal/policy_tags em todo evento desde o dia 1; identidade não pode ser retrofitada |
| M1 Ingestão + Store imutável | F1 essencial (sem federation/edge) + F2 | R1 | 1ª propriedade demonstrável: história reproduzível; policy_id/lineage_ref como campos reservados |
| M2 Transformação + Security mínima | F3 + F4a (policy engine, audit) | R2 | gate incremental exige F2; enforcement antes de dados sensíveis fluírem |
| M3 ER + Ontology juntas | F7-lite + F6 + lineage dataset→object | R3 | resolve circularidade F6↔F7; 1º valor de negócio visível |
| M4 Loop operacional | F8 + F9-lite (busca de objetos) + F4 núcleo em R4 | R4–R5 | 1ª execução do ciclo observe→decide→act→write-back |
| M5 Security hardening | F4 completa (lineage colunar, redaction, noninterference) | pós-R5 | endurecer propagação só faz sentido com transforms/objetos reais |
| M6 Escala de acesso | F9 completa + F1 avançado (federation, edge) | R6 | search em escala com volume real; federation com fonte real |
| M7 Distribuição | F5 inteira (sobre objects/actions) | R7-track | agora existe o que replicar (mutações de objetos com policy) |
| M8 AIP progressivo | F10 em 4 degraus | R7–R8 | AIP é consumidor da plataforma; autonomia em degraus |
| M9 Closed-loop + Hardening | F11 | pós-R8 | validação sistêmica, não construção |

## Erros corrigidos (referenciar nos marcos)

- E1: F5 estava na posição 5 mas replica objects/actions (F7/F8) → movida para M7.
- E2: F4 tardia como security / cedo como lineage completo → dividida em F4a (M0–M2),
  núcleo (M4/R4) e hardening (M5).
- E3: F6↔F7 circular (ER precisa de Ontology p/ resolver; Ontology precisa de ER p/
  identidades) → construídas juntas no M3.
- E4: Identidade/IAM/SSO não existia em fase nenhuma → criada no M0.
- E5: Event bus nunca era construído → decisão de mensageria no M0 (outbox Postgres).
- E6: Acoplamento F2↔F4 (policy_id/lineage_ref no version record) → campos reservados
  desde o schema da R1.
- E7: Risco "ano sem valor" → gates mínimos por release, vertical slice em R5.

## Stack fixa (usar "Com o quê" consistente)

TypeScript (Node 22) end-to-end · pnpm workspaces + Turborepo (monorepo) · modular
monolith · Postgres 16 (metadados, filas, objetos, grafo via recursive CTE, pgvector
futuro) · MinIO (S3) + Parquet (immutable store) · DuckDB embedded (transform SQL) ·
Postgres outbox + LISTEN/NOTIFY + pg-boss (mensageria/jobs) · Fastify + Zod (API) ·
better-auth atrás de IdentityProvider interno (auth) · scheduler próprio (topological
sort + pg-boss) · Next.js + shadcn/ui + TanStack Query (front) · pino + OpenTelemetry →
Jaeger + Prometheus/Grafana (observability) · Vitest + Testcontainers + Playwright
(testes) · docker compose apenas (dev local) · Meilisearch (busca, a partir do M4/R6).
Upgrades nomeados: Kafka, Neo4j, Keycloak/OIDC, K8s, Iceberg, Temporal, Elasticsearch.

## Contratos já definidos (não reinventar; referenciar)

Em `packages/contracts/v1`: Connector (discover/schema/snapshot/read/checkpoint/health),
CanonicalEvent (envelope com event_id, source_system, principal, policy_tags,
payload_hash...), DatasetStore (createDataset/commitVersion/getLatestVersion/getVersion/
diff/snapshot(at)/listVersions — CommitInput inclui policyId e lineageRef RESERVADOS),
TransformationEngine (register/run/dependentsOf; PipelineRun com inputVersions[]→
outputVersion), PolicyEngine.authorize(principal, resource, operation, context)→
allow|deny|partial, OntologyRegistry + ObjectService (getObject(at?)/queryObjects/
traverseLinks/getHistory/getProvenance), ActionEngine (ActionDef com parameterSchema,
preconditions, authorizationPolicy, sideEffects; ActionRequest com
expectedObjectVersions + idempotencyKey + reason; ActionResult committed|denied|
conflict|validation_failed; pipeline FIXO authorize→validate→tx→write-back→audit).

## Estrutura do monorepo (referência)

packages/contracts (v1/, v2/ — intangível sem ADR), packages/core, packages/testing
(golden fixtures), modules/{ingest,transform,ontology,policy,search,aip},
connectors/{postgres,csv,rest}, apps/{api,worker,web}, docs/adr, docs/arch,
migrations/ (SQL numerado, sempre revisado linha a linha), .cursor/rules/*.mdc.

## Template OBRIGATÓRIO por marco (seguir exatamente)

### M{n} — {NOME} (cobre F{x}[, F{y}] da blueprint original · Release R{k})

**Por que nesta posição:** 2–4 frases ligando à ordem corrigida.
**Erros corrigidos aqui:** referência a E1–E7 quando aplicável.

#### Patentes → problema técnico → invariante
Tabela: | Patente | Família/tema | Problema técnico que mapeia | Invariante/teste que geramos |
LISTAR TODAS as patentes que a blueprint original associa a essas fases (ler
/mnt/agents/output/blueprint_original.txt), agrupadas por família como no original.
Não inventar patentes; usar exatamente as do documento. Design patents NÃO entram aqui.

#### O que construir
Componentes detalhados; modelos de dados com campos; APIs. Mínimo primeiro, com nota
"endurece em M{x}" quando aplicável.

#### Com o quê (stack)
Itens da stack fixa + justificativa de 1 linha quando não óbvio.

#### Contratos congelados neste marco
Quais contratos congelam; quais tipos são definidos já mas congelam depois.

#### Testes obrigatórios
Todos os T-tests da blueprint original pertencentes a essas fases (renumerados para o
marco) + testes novos exigidos pelos erros corrigidos + gate de saída (critério de
aceite demonstrável).

#### Tasks para o Cursor
Sequência numerada de tasks, cada uma = 1 sessão de Cursor (1–3 arquivos + testes,
~30–60 min), na ordem exata de implementação, começando por contratos/migrations.
