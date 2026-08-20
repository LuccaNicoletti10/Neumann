# ADR-0022: AIP Gateway read-only (Passo 35)

- Status: accepted
- Date: 2026-08-20
- Deciders: Neumann kernel maintainers
- Contracts touched: `packages/contracts/src/v1/aip.ts`
- Packages touched: `aip-gateway`, `platform-api`, `contracts`
- Migration: none
- Does not alter: Actions write path, FunctionRuntime, ObjectRepository authority

## Context

Passo 35 (Bloco 12 Degrau 1) requires NL → grounded ontology answers without a second object store and without LLM writes. Patent sketches in Python (parallel Ontology Maps, Cypher/SQL generation, Flask GUIs, domain-named profiles) contradict the kernel constitution.

## Decision

1. **Language:** TypeScript / Node 24 only. No Python runtime in production packages.
2. **One public API:** `createAiGateway(opts).ask(req)` in `packages/aip-gateway`.
3. **Contracts** in `contracts/v1/aip.ts`: ask request/response, citations, tool defs, `LlmProvider` port.
4. **Tools are read-only wrappers** over an injected `AipObjectReader` (platform-api wires `SecuredReads`). Registry refuses non-`read` risk.
5. **LLM is an adapter** (`MockLlm` for tests/demo; OpenAI-compatible HTTP). Swapping `opts.llm` must not change citations from the same tool results.
6. **Output filter** re-applies redaction and requires citations resolvable from this turn’s tool results (US20240403396A1 mapped onto existing `PolicyRuntime.redactProperties`).
7. **Profiles** are data (templates + role hint), not a second policy engine (US20240419658A1).
8. **HTTP:** `POST /api/v2/ontologies/:ontologyId/aip/ask` authorized as `admin:aip-ask`. Mutations remain ActionExecutor only.
9. **No GUI** in packages. No Neo4j/Cypher path. No ontology write from AIP.

## Consequences

### Positive

- Grounding uses the same ObjectRepository/policy as HTTP reads.
- Model swap is a port injection, not a fork of the gateway.

### Cost

- Degrau 2–4 (propose/execute Actions, eval suite) are later ADRs.
- Rich UI orchestration (EP4443310 panes) stays out of the kernel; session metadata may grow later without owning objects.

## Alternatives rejected

- Porting the Python patent samples as packages — second ontology, writes from NL, Flask, domain hardcoded.
- Letting the LLM emit SQL/Cypher against stores — bypasses SecuredReads and ObjectSet.
- Mounting AIP only in `mcp-server` — MCP is an HTTP client; Degrau 1 needs in-process secured tools.
