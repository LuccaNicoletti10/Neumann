# ADR-0001: Supported Node runtime is 24 LTS

- Status: accepted
- Date: 2026-08-17
- Deciders: Neumann kernel maintainers
- Contracts touched: none
- Packages touched: root `engines`, `.nvmrc`, `.node-version`, `.github/workflows/ci.yml`

## Context

The 2026-08-17 baseline (`docs/quality/baseline-2026-08-17.md`) ran locally on **Node 26.3.1** while CI used **Node 20**. `engines` allowed `>=20`.

That split is not a supported matrix. The `execution-sandbox` worker test expected `TIMEOUT` and observed `MEMORY_LIMIT` on Node 26 because `worker.terminate()` after the timeout produced a non-zero exit that the runner misclassified. The same suite must not be “fixed” by accepting either result depending on the Node major.

Node 20 is EOL. Node 26 is Current, not the LTS this kernel will support.

## Decision

The only supported runtime for this baseline is **Node 24 LTS** (`^24.0.0`).

- Root `package.json#engines.node` is `^24.0.0` (24.x, not 20 or 26).
- `.nvmrc` and `.node-version` pin `24`.
- Every CI job uses `node-version: 24`.
- Worker isolation bugs are classified by cause (`TIMEOUT` vs `ERR_WORKER_OUT_OF_MEMORY`). They are not papered over with version-dependent expected values.

## Consequences

### Positivas

- One runtime for local, CI, and gates.
- Fail-closed: Node 26 is outside `engines`; a concurrency bug cannot be hidden as “passes on 20, fails on 26”.

### Negativas / custo

- Contributors on Node 20 or 26 must switch to 24. nvm/fnm should read `.nvmrc`.

### Invariantes que os testes devem provar

- Negativo: timeout-initiated `worker.terminate()` is `TIMEOUT`, never `MEMORY_LIMIT`.
- Negativo: only `ERR_WORKER_OUT_OF_MEMORY` (or the equivalent Worker OOM signal) is `MEMORY_LIMIT`.
- A generic non-zero worker exit is not `MEMORY_LIMIT`.
- The same test does not accept two reasons.

## Alternatives considered

### Alt A — Keep Node 20 because CI already used it

Rejected. Node 20 is EOL. Pinning an EOL runtime as the baseline would freeze the kernel on a dead LTS.

### Alt B — Allow Node 26 because it is installed locally

Rejected. Node 26 is not LTS. It already diverged on Worker termination. Supporting two majors would require either weakening asserts or maintaining two expected results.

### Alt C — `engines: >=24` (include future majors)

Rejected. The next Current major would reintroduce the same silent divergence. Major upgrades require a new ADR and a re-run of isolation tests under that major.

## Migration

Install Node 24 (`nvm install 24`), then `pnpm install --frozen-lockfile`. No lockfile or library major updates are required for this decision.

## Follow-up

Policy, Actions, bootstrap, and object-platform refactors are out of scope. This ADR only freezes the Node major used to judge the baseline.
