# Applications (above the platform)

Domain applications live here. They **may** import platform packages under `packages/`.

The platform (`packages/*`) must **never** import from `apps/*`.

```
applications  →  platform
```

Never:

```
platform  →  applications
```

## Examples

| App | Role |
|---|---|
| `erp-simulator/` | Fake ERP / writeback sink (latency, 500, 429, idempotency) — **not** a real ERP |
| *(future)* `production_planning/` | Forecast, netting, scheduling — ontology content + Action handlers only |
| `console/` | Object Explorer / Workshop-like UI consuming `/api/v2` |

Kernel packages stay domain-neutral: Ontology, Objects, Links, ObjectSets, Actions, Datasets, Policy.
