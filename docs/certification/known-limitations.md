# Known limitations — kernel certification

1. **Function isolation:** código de Function semi-confiável. `worker_threads` + `vm` não é sandbox contra autor hostil. Isolamento por processo/container não implementado.
2. **Artifact publish:** sem rota HTTP privilegiada; publish via `PlatformContext.functionArtifacts`.
3. **PostgresOutboxStore:** permanece no CLI/demo do event-bus sobre a mesma tabela `outbox_events`. Produção HTTP/Actions usam `createPgOutboxRepository` + `OutboxDispatcher`. Gate estático proíbe import em `platform-api/src`.
4. **query-api inverted index:** projeção CLI; não montada em `/api/v2`. Search HTTP = catalog SQL (`0013`).
5. **KnowledgeGraph Maps facade:** `createKnowledgeGraph` ainda existe para CLI/classification; `PlatformContext.graph` é `GraphQueryEngine` sem estado.
6. **Draft ontology PG:** drafts session-local; trabalho não commitado não sobrevive restart.
7. **Certificação industrial:** cobre ontology/objects/links/graph/Function/Action/outbox/isolamento cross-ontology e redaction. Connectors CSV/HTTP/webhook completos e matriz de 10 falhas estão cobertos por suítes Prompt 10/11 e reliability tests; o gate de certificação agrega as provas PG críticas, não reexecuta cada conector isoladamente.
8. **Performance:** planos SQL documentados onde há EXPLAIN (catalog GIN). Não há promessa de throughput wall-clock.
