# ADR-0003: Canonical runtime policy is PolicyEngine/EPID behind PolicyRuntime

- Status: accepted
- Date: 2026-08-18
- Deciders: Neumann kernel maintainers
- Contracts touched: none (`PolicyEngine` / `AuthorizeRequest` stay v1)
- Packages touched: `policy-engine`, `platform-api`, `explore-api` (type surface), `infra/sql/0015_policy_overlay.sql`

## Context

HTTP Actions and Reads were governed by `OntologyAuthorizer`. `PolicyEngine` (EPID graph, `0010_policy.sql`) was hydrated on postgres (`policyReady = policy.hydrate()`) and never awaited, never consulted by `/api/v2`. Persist used `enqueue` + `console.error` so a store failure still looked like success. Memory defaulted to `allowAll`. `platform-api` CLI seeded principals `lucca` / `svc-projector`.

Two public evaluators for one concept. Partial bootstrap. See `docs/architecture/current-state.md` §3.1 and §8.

## Decision

One runtime module: `createPolicyRuntime() → Promise<PolicyRuntime>`.

- **Kernel:** `PolicyEngine` / EPID evaluates native resource nodes from a frozen snapshot (`grants`, `nodes`, `epids`).
- **HTTP schemes** (`object:`, `action:`, `action-execution:`, `link:`, `admin:`) are compiled from a durable **overlay** (roles, grants, field masks, classification) stored on the same snapshot generation. Overlay is not a second engine.
- `OntologyAuthorizer` / `createOntologyAuthorizer` compile a fixture overlay into a `PolicyRuntime`. They are not an HTTP authority.
- Resource IDs are built only via `ResourceIds`. Routes do not concatenate schemes.
- Administrative commands (`PolicyAdmin`) are async and separate from `authorize`: validate → persist transactionally → rebuild snapshot → **atomic publish** → audit. Persist failure throws; generation is unchanged.
- Bootstrap (`createPlatformRuntime`) awaits policy (and seed) before `listen`. `/health` is liveness. `/ready` is 200 only when `ctx.ready === true`.
- Allow-all exists only as the named fixture `allow-all` (`ALLOW_ALL_POLICY_OVERLAY` / `policyFixture: 'allow-all'`). No implicit default.

`AuthorizeFn` on `ActionExecutor` is `policy.authorize` of that same instance.

## Consequences

### Positivas

- One generation, one decision function, memory and PostgreSQL share the contract.
- Fail-closed absence of overlay/nodes. Hidden-miss on deny (empty list / missing get, not a leaky 403).
- Persist is visible. Bootstrap does not open the business port on a half-ready process.

### Negativas / custo

- Overlay JSON on `policy_meta` is the RBAC compiler output; EPID nodes remain the graph kernel. Mapping every object type to a unique EPID node is not required for wildcards (`object:*`).
- `createPostgresPlatformContext` / `createPlatformRuntime` are async.
- Tests must name `policyFixture: 'allow-all'` (or pass a compiled runtime).

### Invariantes que os testes devem provar

- Negativo: missing overlay/nodes → deny; persist throw → generation unchanged; hydrate/seed throw → resources closed, no listen.
- Concurrent readers observe generation N or N+1, never mixed overlay+nodes.
- Restart PostgreSQL: same overlay + grants → same allow/deny.
- Memory ≡ PG overlay decisions for the same snapshot.
- Redaction runs before aggregate. Denied types do not contribute to count.
- No product call site uses `OntologyAuthorizer` as a second authority beside `ctx.policy`.

## Alternatives considered

### Alt A — Keep OntologyAuthorizer as HTTP authority; hydrate EPID for later

Rejected. Leaves two evaluators. `policyReady` would stay a lie.

### Alt B — Delete OntologyAuthorizer and force every object type onto an EPID node

Rejected for this ADR. Wildcard `*` cannot be expanded without an ontology at policy-write time. Overlay on the same generation is the compiler output; a later ADR may expand wildcards into nodes when the ontology is the write-time input.

### Alt C — Third wrapper that calls both and ANDs decisions

Rejected. APoSD: one module, one snapshot.

## Migration

1. Apply `0015_policy_overlay.sql`.
2. Replace `ctx.authorizer` with `ctx.policy` (`PolicyRuntime`).
3. CLI: no hardcoded principals; `PLATFORM_POLICY_FIXTURE=allow-all` is the named demo escape hatch.
4. `createOntologyAuthorizer` remains as the fixture compiler for tests and explore demos.

## Follow-up

HTTP POST/PUT/DELETE `/objects` and `/links` are 405 tombstones (ADR-0005). Ingest is in-process `ProjectionWriter`. EPID admissions (`createResource`) stay on `PolicyEngine` and are not yet an HTTP admin API.
