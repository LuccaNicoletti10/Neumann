# ADR-0024: AIP evaluation framework + adversarial suite (Passo 37)

- Status: accepted
- Date: 2026-08-20
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/aip-eval.ts`
- Packages touched: `aip-eval`, `contracts`, `aip-gateway` (timeout / fail-closed helpers)
- Migration: none
- Does not alter: ActionExecutor authority; ObjectRepository writers; Passo 35/36 public ask/agent HTTP shape

## Context

Passo 37 requires a versioned agent evaluation suite with metrics and **11 mandatory adversarials**. Patent samples (Flask UIs, sklearn eval dashboards, auto-apply code patches from LLM) contradict the kernel constitution.

## Decision

1. **Language:** TypeScript / Node 24 only. No Python/sklearn/Flask/plotly ports.
2. **Package:** `packages/aip-eval` — runner + suite fixtures + metrics. Depends on `contracts` + `aip-gateway`. Does **not** invent a second agent runtime.
3. **Eval case contract:** `AipEvalCase` pins `input`, `context`, `allowedTools`, `expectedFacts`, `expectedAction`, `forbiddenActions`, `rubric`, `modelVersion`, `promptVersion`, `agentVersion`. Results are `AipEvalCaseResult` with metrics.
4. **Authority under test:** `createAiGateway().ask` and `createAiAgent().run` only. Mutations in cases go through `AipActionPort` (ActionExecutor).
5. **Eleven adversarials (gate):** `prompt_injection`, `exfiltration`, `unauthorized_tool`, `fake_instructions_in_document`, `poisoned_search`, `stale_context`, `conflicting_facts`, `infinite_loop`, `action_duplication`, `tool_timeout`, `model_outage`. Suite fails if any adversarial is not resisted.
6. **Error analysis (US20260127063 / US 12,487,876):** structured `analyzeEvalFailure(trace)` — explanation + suggested remediation for humans. **No auto-apply** of code patches to the repo.
7. **Model eval (US20240420258):** subset metrics on agent/ask runs — not a general ML training dashboard.
8. **Out of kernel:** Plotly charts, FAISS corpora, Customer/housing datasets, OpenAI keys in package defaults.

## Consequences

### Positive

- Regression gate for AIP before apps/verticals.
- Adversarial resistance is executable, not aspirational.

### Cost

- Harness uses MockLlm / scripted ports; live LLM eval is optional and out of CI default.

## Alternatives rejected

- Porting `agent_evaluation_framework` Python as authority.
- LLM auto-fix of production code.
- Second mutation path for “eval-only writes”.
