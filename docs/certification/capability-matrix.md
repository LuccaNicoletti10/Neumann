# Capability matrix — kernel Neumann

| Capacidade | Supported | Experimental | Not implemented | Evidence |
|---|---|---|---|---|
| PolicyRuntime HTTP + Actions | ✓ | | | `policy-engine` PG + platform-api authz |
| OntologyRegistry versionado | ✓ | | | `ontology-registry` + evolution tests |
| ObjectRepository / LinkRepository | ✓ | | | storage contract memory+PG |
| ObjectHistoryStore + seq | ✓ | | | 0026 + `prompt12-readseq` |
| ObjectSet query | ✓ | | | `gate:objectset-parity` |
| GraphQueryEngine | ✓ | | | `graph-query.test.ts` (integrity + multi LinkType) |
| Catalog search (GIN) | ✓ | | | `object-set` catalog EXPLAIN |
| query-api inverted index | | ✓ | | CLI only; not on `/api/v2` |
| IngestionRuntime + webhook | ✓ | | | Prompt 10B/10C integration |
| MappingVersion imutável | ✓ | | | ADR-0018 |
| ActionExecutor + idempotency | ✓ | | | action-engine PG |
| FunctionRuntime + readSeq | ✓ | | | ADR-0019/0020/0021 |
| Audit + operational events | ✓ | | | Action UoW |
| OutboxDispatcher (uma tabela) | ✓ | | | `createPgOutboxRepository` claim/ack/DLQ |
| Clock / IdGenerator canónicos | ✓ | | | `object-platform` determinism |
| Production fail-closed | ✓ | | | `assertProductionConfig` |
| Hostile Function isolation | | | ✓ | worker_threads ≠ process jail |
| HTTP artifact publish | | | ✓ | publish via context API only |
| PostgresOutboxStore CLI | | ✓ | | not production HTTP path |

Supported exige prova E2E PostgreSQL. Experimental não monta produção. Not implemented é dívida explícita.
