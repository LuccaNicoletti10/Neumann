# Function Runtime — 2026-08-19

Durable, versioned, governed Functions (ADR-0019). Complements `docs/architecture/current-state.md`.

## Path

```
OntologyVersion.functionTypes[id].artifactHash
        ↓ pin at create (latest allowed only here)
FunctionExecutionPin
        ↓
function_artifacts (SHA-256 bytes, append-only)
        ↓ worker claim CAS
FunctionRuntime.runOnce
        ↓
history.asOf(readAsOf) + current redaction → execution-sandbox worker
        ↓ optional
ActionExecutor.apply (idempotency fn:{executionId}:{step})
```

HTTP (`routes/functions.ts`) only calls `ctx.functions.create|get|cancel`. The worker (`bin/function-worker.ts`) is a separate process and waits for `ready`.

`createFunctionRegistry` is CLI/demo. Production is `FunctionRuntime` on `PlatformContext.functions`.

## Threat model

Function source is **semi-trusted** (ontology publishers). Isolation is `worker_threads` + `vm` + static scan. That is **not** a sandbox against hostile tenants. Hostile code would need a process/container boundary, which is not implemented.

## Debt

- Artifact publish is not an HTTP route.
- Log events are truncated at the sandbox; they are not a durable audit of Function stdout.
