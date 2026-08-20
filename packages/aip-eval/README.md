# aip-eval (Passo 37)

Versioned AIP evaluation suite: metrics + **11 mandatory adversarials**.

- `runAipEvalSuite()` — executes fixtures against `createAiGateway` / `createAiAgent`
- `analyzeEvalFailure()` — human remediation only (**no auto-apply**)
- Contract: `contracts/v1/aip-eval.ts` (ADR-0024)

```bash
pnpm --filter aip-eval test
pnpm aip-eval
```

Adversarials: prompt injection, exfiltration, unauthorized tool, fake document instructions, poisoned search, stale context, conflicting facts, infinite loop, action duplication, tool timeout, model outage.
