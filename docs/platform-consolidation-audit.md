# Platform consolidation audit

Baseline: `pnpm typecheck` green (2026-08-12). Pre-existing defects verified against source.

| ID | Severity | Status | Phase | Affected | Correction |
|---|---|---|---|---|---|
| P0 | Critical | PARTIAL | B | object-platform, knowledge-graph, platform-api | GraphQueryEngine over repos; shared context stores; createObjectPlatform Maps still exist (compat) |
| P1 | High | DONE | B | determinism.ts, contexts | SystemClock + UuidIdGenerator production defaults |
| P2 | High | DONE | B | pg-object-repository.ts | Atomic CAS `AND version = $expected` |
| P3 | High | PARTIAL | B | pg list orderBy | Property orderBy added; full contract suite pending |
| P4 | High | DONE (memory) | B | object-repository | Soft-delete revive same id; PG ON CONFLICT revive |
| P5 | High | PARTIAL | B | link-repository | Cardinality semantics fixed; optional objectExists |
| P6 | High | PARTIAL | C | ontology-registry | listOntologies(); PgOntologyRegistry schema in 0003 |
| P10 | High | DONE | B | graph-query.ts | Repository-backed GraphQueryEngine |
| P11 | High | PARTIAL | C | context.ts | createMemory* / createPostgres*; ontology still memory in PG mode |
| P12 | High | PARTIAL | D | routes v2 | X-Principal gated; Bearer stub |
| P14 | Medium | DONE | D | api-errors | NeumannApiError + Fastify handler |
| P15 | Medium | DONE | D | pagination | Opaque page tokens |
| P17 | Medium | PARTIAL | I | object-set | NOT_EQUALS/ENDS_WITH + alias normalize |
| P29 | Medium | DONE | G | connector-postgres | Config PK/watermark + quoteIdent + PK discovery |
| P40 | Medium | PARTIAL | D | listOntologies | Fixed GET /api/v2/ontologies |
| P42–P43 | — | DONE | D | api-errors, pagination | Adapted from OpenFoundry |
| P64 | Med | DONE | L | .github/workflows/ci.yml | typecheck/test/build |
| P65 | Med | PARTIAL | L | one-truth test | Architecture import scan |

## Baseline inventory

- 39+ packages under `packages/*` (+ `api-errors`, `pagination`)
- SQL: `0001_outbox.sql`, `0002_objects_platform.sql`, `0003_history_ontology.sql`
- OpenFoundry reference: `/tmp/openfoundry-reference` (Apache-2.0)

## Still remaining (next sessions)

| Area | Gap | Proves gap |
|---|---|---|
| P0 complete | `createObjectPlatform` still has private Maps | projector DI not fully migrated |
| P7–P8 | OntologyObjectService | no schema rejection test on /api/v2 |
| P13 | Policy on every route | unauthorized aggregate test missing |
| P21–P26 | Durable Action UoW + outbox | failure midway leaves partial state |
| P66 | Full source→action→writeback E2E | no PG integration job yet |
| P19 | SQL ObjectSet planner | only memory evaluator |

## Working rule

Memory adapters = tests/demos only. Production path = PostgreSQL + fail-fast without `DATABASE_URL`.
