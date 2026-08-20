# Kernel certification — 2026-08-20

Certificação do Neumann como kernel operacional genérico antes da integração com ERP real.
ADR: [`../architecture/adr/0021-kernel-certification-authorities.md`](../architecture/adr/0021-kernel-certification-authorities.md).

## Pipeline certificado

```
Connector → Mapping → Ontology → Objects/Links → Query/Graph
  → Function (history.asOf + readSeq) → Action → History/Audit/Outbox
```

Domínio da empresa fictícia existe **somente** em `docs/certification/fixtures/industrial/` e testes de certificação. Não em `packages/*/src`.

## Evidência PostgreSQL

| Capacidade | Evidência |
|---|---|
| Outbox único | `event-bus` OutboxDispatcher + `outbox-dispatcher.contract.test.ts` |
| Temporal multirréplica | `prompt12-readseq.integration.test.ts` (clock congelado, dois pools) |
| Function asOf | ADR-0020 + `readSeq` (0026) |
| Graph integrity | `knowledge-graph/tests/graph-query.test.ts` |
| Ontology evolution | `ontology-evolution.integration.test.ts` |
| Cenário industrial | `prompt12-certification.integration.test.ts` |
| Production fail-closed | `assert-production-config.test.ts` + `verify:production` |

## Gates

```
pnpm gate:certification
pnpm verify:production
```

## Limitações

Ver [`known-limitations.md`](./known-limitations.md).
