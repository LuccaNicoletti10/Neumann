# event-bus

Transactional outbox + LISTEN/NOTIFY + job queue with retry for NEUMANN **PASSO 4 / TM0.3**.

## Gate

**evento commitado na transação é entregue ao consumer; restart não perde job**

Writer commits business data and outbox records in the **same transaction**. The publisher delivers **at-least-once**; the consumer is **idempotent by `event_id`**. Restarting the publisher does not lose jobs — unpublished outbox rows are retried until marked published.

```bash
npm run build
npm run cli -- gate
```

## Architecture

| Component | Role |
|-----------|------|
| `InMemoryTransactionalStore` | Simulates transactional outbox + LISTEN/NOTIFY via `EventEmitter` (unit tests, no Docker) |
| `PostgresOutboxStore` | Optional adapter when `DATABASE_URL` is set (`pg` + real `LISTEN/NOTIFY`) |
| `OutboxPublisher` | Poll + notify driven delivery, key-ordered, at-least-once |
| `IdempotentConsumer` | Dedup by `event_id` |
| `InMemoryJobQueue` | Priority + round-robin fair dequeue, retry/backoff with `FakeClock` |
| `createPgBoss` | Thin optional wrapper for Postgres job queue |

## CLI

```bash
npm run cli -- demo          # write tx → publish → consume
npm run cli -- serve --port 8787
npm run cli -- gate          # TM0.3 gate scenario (exit 0/1)
```

## HTTP API (`serve`)

- `POST /events` — body `{ topic, key, payload, principal?, tenantId?, traceId? }`
- `GET /health`

## Tests

```bash
npm test
```

No Docker required for unit tests. Postgres/pg-boss integration runs only when `DATABASE_URL` is set.

## Constraints

- Node 20+, TypeScript `5.5.4`, `@types/node` `20.14.15` (pinned)
- ESM (`"type": "module"`), NodeNext module resolution
- Zero workspace coupling to sibling packages
