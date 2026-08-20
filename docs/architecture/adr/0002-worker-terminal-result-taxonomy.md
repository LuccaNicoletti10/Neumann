# ADR-0002: Worker terminal result taxonomy

- Status: accepted
- Date: 2026-08-17
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/sandbox.ts` `SandboxDenyReason` (+ `EXECUTION_ERROR`)
- Packages touched: `execution-sandbox`

## Context

`runInWorker` classifies how a worker thread ends. After ADR-0001, a timeout-initiated `worker.terminate()` was no longer reported as `MEMORY_LIMIT`. The remaining gap: any other non-zero exit was reported as `FORBIDDEN_API`.

That is false. An unexpected `exit` is not evidence that a forbidden API ran. `FORBIDDEN_API` is only valid when the worker detector observed `require` / dynamic `import` (or the equivalent VM error). Exit code 1 after `terminate()`, a thrown transform error, or a runtime crash are different causes.

`SandboxDenyReason` had no public member for “the isolate died without a policy deny”. Mapping that case onto `FORBIDDEN_API` made consumers branch on a lie. See `docs/quality/baseline-fixes-2026-08-17.md` §1.1 and the Prompt 01B.1 residue.

## Decision

One terminal cause per run. The first valid causal event wins; later events are ignored. Wall-clock, isolated exit codes, and missing config are not substitutes for that event.

| Evidence | Public result |
|---|---|
| Timeout timer started shutdown | `TIMEOUT` |
| Worker `error` with `ERR_WORKER_OUT_OF_MEMORY` (or equivalent OOM) | `MEMORY_LIMIT` |
| Detector identified a forbidden Node API | `FORBIDDEN_API` |
| `AbortSignal` aborted the run | `CANCELLED` (runner result; not a policy deny) |
| Unexpected `error` / `exit` without a prior cause | `EXECUTION_ERROR` |
| Worker posted a successful result | success |

`EXECUTION_ERROR` is added to `SandboxDenyReason` so `SandboxRunResult` can report a crash without overloading `FORBIDDEN_API`. The name of the field stays `deniedReason` (frozen shape); the new member is a terminal failure, not a policy deny.

`CANCELLED` stays on the worker runner. The sandbox HTTP/in-process API does not take an abort signal in this ADR, so it is not added to the contract union.

Classification lives in `execution-sandbox` (`bindWorkerTerminal`). Callers consume `WorkerRunResponse` / `SandboxRunResult`. They do not inspect exit codes.

## Consequences

### Positivas

- Timeout, OOM, forbidden API, cancel, crash, and success are disjoint and testable.
- Generic exit is not `FORBIDDEN_API` and not `MEMORY_LIMIT`.

### Negativas / custo

- `deniedReason` now includes a non-policy failure. A future ADR may split “deny” from “execution failure” if a second public result type is required. Not in this change.

### Invariantes que os testes devem provar

- Success posts `ok: true`.
- Timer-initiated terminate is `TIMEOUT`; a later `exit` cannot overwrite it.
- Only `ERR_WORKER_OUT_OF_MEMORY` is `MEMORY_LIMIT`.
- Detector evidence is `FORBIDDEN_API`; `require('fs')` is that detector, not an inferred exit.
- Unexpected exit is `EXECUTION_ERROR`.
- Abort is `CANCELLED` on the runner.
- `createOnceSettler` / bind: exactly one settle.

## Alternatives considered

### Alt A — Keep mapping generic exit to `FORBIDDEN_API`

Rejected. It is not causal. It made `require(fs)` and a crashed isolate indistinguishable.

### Alt B — New `SandboxRunResult.status` parallel to `deniedReason`

Rejected as a second public result for the same failure. One channel; extend the union.

### Alt C — Infer OOM or forbidden API from exit codes

Rejected. Exit codes are effects. Node does not reserve a stable code for “forbidden API”.

## Migration

Additive union member. Existing reasons keep their meaning. Worker runner no longer emits `FORBIDDEN_API` from `exit`.

## Follow-up

In-process `run()` still maps unknown throws to `FORBIDDEN_API` (pre-existing). Converging that path onto `EXECUTION_ERROR` is a later change; it is not required to fix worker isolation.
