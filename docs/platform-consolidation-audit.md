# Platform consolidation audit

Baseline: durability wiring in `createPostgresPlatformContext` (2026-08-12). Pre-existing defects verified against source.

| ID | Severity | Status | Phase | Affected | Correction |
|---|---|---|---|---|---|
| P0 | Critical | PARTIAL | B | object-platform, knowledge-graph, platform-api | GraphQueryEngine over repos; shared context stores; createObjectPlatform Maps still exist (compat) |
| P1 | High | DONE | B | determinism.ts, contexts | SystemClock + UuidIdGenerator production defaults |
| P2 | High | DONE | B | pg-object-repository.ts | Atomic CAS `AND version = $expected` |
| P3 | High | PARTIAL | B | pg list orderBy | Property orderBy added; full contract suite pending |
| P4 | High | DONE (memory) | B | object-repository | Soft-delete revive same id; PG ON CONFLICT revive |
| P5 | High | PARTIAL | B | link-repository | Cardinality semantics fixed; optional objectExists |
| P6 | High | DONE | C | ontology-registry | PgOntologyRegistry + restart gate |
| P10 | High | DONE | B | graph-query.ts | Repository-backed GraphQueryEngine |
| P11 | High | DONE | C | context.ts | createMemory* / createPostgres*; PG mode uses PG ontology/events/executions/audit |
| P12 | High | PARTIAL | D | routes v2 | Bearer token = principal id; IAM verification remaining |
| P14 | Medium | DONE | D | api-errors | NeumannApiError + Fastify handler |
| P15 | Medium | DONE | D | pagination | Opaque page tokens |
| P17 | Medium | PARTIAL | I | object-set | NOT_EQUALS/ENDS_WITH + alias normalize |
| P21–P26 | High | DONE | E | action-engine | UnitOfWork + PgActionExecutionStore + idempotency + outbox in same tx |
| P29 | Medium | DONE | G | connector-postgres | Config PK/watermark + quoteIdent + PK discovery |
| P40 | Medium | PARTIAL | D | listOntologies | Fixed GET /api/v2/ontologies |
| P42–P43 | — | DONE | D | api-errors, pagination | Adapted from OpenFoundry |
| P64 | Med | DONE | L | .github/workflows/ci.yml | typecheck/test/build + Postgres service |
| P65 | Med | PARTIAL | L | one-truth test | Architecture import scan |
| Audit durability | High | DONE | C | policy-engine | PgAuditRepository + advisory lock + restart/concurrency/redact gates |
| Canonical outbox | High | DONE | E | event-bus | `outbox_events` only; `business_data` / `outbox` removed from PG adapter |

## Baseline inventory

- 39+ packages under `packages/*` (+ `api-errors`, `pagination`)
- SQL: `0001_outbox.sql`, `0002_objects_platform.sql`, `0003_history_ontology.sql`, `0004_audit.sql`, `0005_writeback.sql`
- OpenFoundry reference: `/tmp/openfoundry-reference` (Apache-2.0)

## Still remaining (next sessions)

| Area | Gap | Proves gap |
|---|---|---|
| P0 complete | `createObjectPlatform` still has private Maps | projector DI not fully migrated |
| P7–P8 | OntologyObjectService | schema rejection now via governed repo + five-pieces gates; OntologyObjectService still absent |
| P13 | Policy on every route | unauthorized aggregate test missing |
| P66 | Full source→action→writeback E2E | SQL-mirror worker exists; HTTP ERP handler still Passo 25 |
| P19 | SQL ObjectSet planner | only memory evaluator |
| Bearer/IAM | token accepted as opaque principal | no IdentityProvider verification |

## Working rule

Memory adapters = tests/demos only. Production path = PostgreSQL + fail-fast without `DATABASE_URL` + fail-closed without `authorize`.
