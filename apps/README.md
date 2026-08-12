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
| *(future)* `production_planning/` | Forecast, netting, scheduling — ontology content + Action handlers only |
| *(future)* `console/` | Object Explorer / Workshop-like UI consuming `/api/v2` |

Kernel packages stay domain-neutral: Ontology, Objects, Links, ObjectSets, Actions, Datasets, Policy.
