# action-engine

Generic Action execution for Neumann (Passo 24).

LLM/UI never write objects. Mutations go through this pipeline:

```
request → authorize → validate → tx (rules + postconditions) → write-back → audit
```

`expectedObjectVersions` (optimistic concurrency) and `idempotencyKey` are enforced.
Unauthorized → `DENIED`. Duplicate key → one execution. Stale version → conflict.

## ActionTypeDef

`inputObjectTypeIds` · `parameters` · `submissionCriteria` (preconditions) · `rules` ·
`postconditions` · `compensation` · `sideEffects` · `auditRequirements`

Rules: `create_object` · `modify_object` · `delete_object` · `create_link` · `delete_link` ·
`generate_document` (safe `{{property}}` templates — US 9,223,773)

Also: parameter tree + variable binding (US 8,732,574 family); ordered action workflows
with dependencies and reprocess (US 8,429,194 / 8,905,597).

## Demo

```bash
pnpm act -- demo
pnpm act -- writeback
```

`writeback` (Passo 25): observe fonte → Action apply → Connector.writeBack → fonte e objeto convergem no audit.
