# policy-engine — Passo 16 + 26 + 27 + 28

`authorize(principal, resource, operation, context) → allow|deny|partial` + security matrix + audit hash-chained + noninterference.

**Patentes:** US 10,432,469 · US 10,397,229 · US20150188715 · WO2022245989 · US 10,044,745

## Escopo (kernel)

- Grafo de nós com **EPID** (policy + parent)
- Herança de policy nula
- Enforcement em leitura: sem permissão → sem objeto e **count = |autorizados|** (`0` ≡ conjunto vazio; nunca `null`)
- Deny ≡ miss: `reason: 'not found'`, `resourceEpid: null`
- Create admissions (authz antes de criar recurso)
- Audit: chain `previousSummaryHash → summaryHash`, verify, redact, detect tamper
- **Passo 28:** 8 canais de noninterference + fuzzer `principal × resource × operation × context`

## Fora deste passo

- Pods / K8s / ingress / vault launch (infra)
- GUI
- LLM / embeddings como produto (canais fail-closed)

## Uso

```bash
pnpm policy -- demo
pnpm policy -- classify
pnpm policy -- redact
pnpm policy -- ni
pnpm --filter policy-engine test
```
