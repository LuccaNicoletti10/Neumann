# ERP Simulator

Test double / writeback sink. **Not** SAP, TOTVS, Omie, or any real ERP.

Use it to destroy Neumann with latency, 500s, 429s, timeouts, and duplicate deliveries — without touching a customer system.

```
pnpm --filter erp-simulator cli
```

- `GET/POST /orders` · `PATCH /orders/:id`
- `GET /inventory` · `PATCH /inventory/:sku`
- `GET /suppliers`
- `POST /writebacks` (generic Action side-effect sink)
- Header `Idempotency-Key` (replay returns the first response)
- Header `X-Simulate-Fault`: `500` | `429` | `timeout` | `latency:2000` | `reset` | `duplicate`
