# ADR-0010 — Action Parameter Validators

**Status:** Accepted  
**Date:** 2026-08-19  
**Scope:** `packages/contracts/src/v1/ontology.ts` — `ActionParameterDef`

## Context

`ActionParameterDef` only had `baseType` and `required`. Prompt 08B required that enum values, regex patterns, and numeric bounds be enforced — not just documented in comments.

The validator module (`action-parameter-validator.ts`) referenced fields that did not exist in the contract (`validators: [{kind, values}]`), making the test assertions false positives.

## Decision

Add optional, typed fields to `ActionParameterDef` (additive — no existing callers break):

- `nullable?: boolean` — separates nullability from requiredness.
- `allowedValues?: readonly (string | number | boolean)[]` — discrete enum.
- `pattern?: string` — ECMAScript regex for string fields.
- `min?: number`, `max?: number` — inclusive numeric bounds.

`ActionParameterValidator` enforces all of these before the business transaction begins.

## Consequences

- All `allowedValues`, `pattern`, and `min/max` validators are now real contract fields, not opaque runtime objects.
- Validator tests use actual `ActionType` definitions with these fields — no reflection or bypass.
- Tests that construct `ActionTypeDef` with `validators: [{kind, ...}]` must migrate to `allowedValues`.

## Non-consequences

- No `v2/` split needed; additions are purely optional.
- Existing `ActionParameterDef` objects without the new fields continue to work.
