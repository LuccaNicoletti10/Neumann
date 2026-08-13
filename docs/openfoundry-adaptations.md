# OpenFoundry adaptations

Reference clone: `/tmp/openfoundry-reference` (Apache-2.0).

| OpenFoundry | Neumann | Mode | Notes |
|---|---|---|---|
| `packages/errors` | `packages/api-errors` | Adapted | NeumannApiError + codes |
| `packages/pagination` | `packages/pagination` | Adapted | Buffer base64url |
| `packages/object-set` | `packages/object-set` | Inspiration | Operators/AST; Neumann owns evaluator |
| `packages/permissions/middleware` | platform-api auth | Inspiration | Bearer; IAM integration ongoing |
| `svc-objects` routes | `platform-api` /api/v2 | Inspiration | Same path shapes; PG persistence |
| `svc-actions` stores | `action-engine` | Planned | Durable executions Phase E |
| `svc-functions` | function-engine | Planned | No `new Function` — sandbox |
| `svc-webhooks` | webhooks package | Planned | Outbox + HMAC |
| in-memory /tmp stores | — | **Rejected** | Never production source of truth |
| microservice-per-capability | — | **Rejected** | Modular monolith |

See `NOTICE` for Apache-2.0 attribution.
