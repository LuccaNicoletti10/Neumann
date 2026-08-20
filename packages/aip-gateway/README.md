# aip-gateway (Passo 35–36)

AI Gateway over the ontology kernel:

1. **Ask (read-only)** — NL → secured reads → filtered answer + citations (`createAiGateway`).
2. **Agent (propose)** — state machine START→…→PROPOSE_ACTION→AWAITING_APPROVAL|VERIFY→DONE; mutations only via `ActionExecutor` (`createAiAgent` + `AipActionPort`).

- LLM is a port (`MockLlm` / OpenAI-compatible). No second ObjectRepository / write HTTP.
- Propose tools require `allowPropose: true`. Ask registry stays read-only.
- Human approval uses the same `/actions/executions/:id/approve` path as Passo 24.

```bash
pnpm --filter aip-gateway test
pnpm --filter platform-api test -- tests/aip-agent.test.ts
pnpm aip -- demo
```

ADRs: `0022-aip-gateway-read-only.md`, `0023-aip-agent-state-machine.md`.
