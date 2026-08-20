# ADR-0023: AIP agent state-machine → Action propose (Passo 36)

- Status: accepted
- Date: 2026-08-20
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/aip.ts`
- Packages touched: `aip-gateway`, `platform-api`, `contracts`, `policy-engine` (admin catalog)
- Migration: none
- Does not alter: ObjectRepository write authority; Passo 35 `ask` remains read-only

## Context

Passo 36 requires Degrau 2–4: LLM agent proposes Actions, optional human approval, then execution via the **same** ActionExecutor as Passo 24. Patent samples (Flask UIs, sklearn K-means few-shot, Customer churn ML, Chart.js viz, free-form Agent Ops) contradict the kernel constitution.

## Decision

1. **Language:** TypeScript / Node 24 only. No Python/sklearn/Flask in packages.
2. **State machine:** Fixed states `START → UNDERSTAND → GATHER_DATA → ANALYZE → PROPOSE_ACTION → (AWAITING_APPROVAL | VERIFY) → DONE | FAILED`. Each state declares `allowedTools`, prompt fragment, `maxIterations`, transition rules. LLM cannot invent states or mutation tools outside the machine.
3. **Public API:** `createAiAgent(opts).run(req)` → `AipAgentRunResponse`. Does **not** replace `createAiGateway().ask` (ADR-0022).
4. **Mutation port:** Injected `AipActionPort` with `validate` + `apply` only. No `objects.create/update/delete` from the agent. Approve/reject remain existing HTTP Action endpoints (`/actions/executions/:id/approve`).
5. **Tool risk:** Registry allows `riskLevel: 'propose'` only when `allowPropose: true` (agent mode). `ask` path keeps read-only registry.
6. **Few-shot (US20260127387):** Optional deterministic centroid-of-hash selector for prompt examples — no sklearn, no second store. Disabled by default.
7. **Out of kernel this ADR:** NL visualization (US20260065540), ontology-trained ML services (EP4668176 beyond FunctionRuntime), Agent Ops multi-agent handoff UIs (US20250110786) — map later or to apps.
8. **HTTP:** `POST /api/v2/ontologies/:ontologyId/aip/agent/run` authorized as `admin:aip-agent`. Production LLM fail-closed same as ask.

## Consequences

### Positive

- Agent cannot bypass ActionExecutor / approval policy.
- Passo 35 ask path unchanged.

### Cost

- Eval suite (Passo 37) still separate.
- Few-shot is a thin helper, not a patent-complete port.

## Alternatives rejected

- Porting Python patent packages as authority.
- Letting the LLM call Action apply without state-machine tool allow-list.
- Second write path for “agent mutations”.
