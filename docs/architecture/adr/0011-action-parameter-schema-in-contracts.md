# ADR-0011: Action parameter schema lives in contracts

- Status: accepted
- Date: 2026-08-19
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/action-parameter-schema.ts` (`compilePattern`, `validateActionTypeDefSchema`, `validateParameterDef`)
- Packages touched: `contracts`, `ontology-registry`, `action-engine`

## Context

Prompt 08B added `ActionParameterDef.pattern` / `allowedValues` / `min`/`max`. Schema admission was copied into both `ontology-registry` (`action-type-schema.ts`) and `action-engine` (`action-parameter-validator.ts`). `pattern.length <= 1000` plus `new RegExp` does not block catastrophic backtracking (`(a+)+$`). `ontology-registry` must not depend on `action-engine`.

## Decision

One implementation: `validateActionTypeDefSchema` / `compilePattern` in `contracts`. OntologyRegistry (add/commit) and ActionExecutor (apply) import that function.

Patterns are a linear-safe subset: no nested quantifiers, backreferences, or lookaround/extensions. `compilePattern` is the only admission gate. Apply-time matching compiles a JS `RegExp` only after that gate. A pathological pattern is rejected at ontology commit and, if a def bypasses the registry, at `validateActionParameters` — it never reaches `RegExp#test` on the event loop.

Static gate: `ontology-registry/src` must not import `action-engine`.

## Consequences

### Positivas

- One schema function. Nested-quantifier patterns cannot hang apply.
- Registry does not import the executor package.

### Negativas / custo

- The subset is stricter than full ECMAScript (no backreferences, no lookaround). Callers that need those features must use `allowedValues` or a new ADR.

### Invariantes que os testes devem provar

- Negativo: `(a+)+$` rejected at `compilePattern`, `addActionType`, and `validateActionParameters`.
- `ontology-registry` source has no `from 'action-engine'` import.

## Alternatives considered

### Alt A — native RE2 addon

Linear-time matching of a larger feature set. Rejected for this change: native compile in CI and a first runtime dependency on `contracts`.

### Alt B — keep two copies, length cap only

Rejected: length does not stop ReDoS; two implementations drift.

## Migration

Delete `ontology-registry/src/core/action-type-schema.ts`. `action-engine` re-exports the contracts functions and keeps apply-time `validateActionParameters`.

## Follow-up

None. PropertyType `{ kind: 'regex' }` uses the same `compilePattern` at ontology commit.
