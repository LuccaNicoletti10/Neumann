# policy-engine — Passo 16

`authorize(principal, resource, operation, context) → allow|deny|partial` + security matrix + audit hash-chained.

**Patentes:** US 10,432,469 · US 10,397,229 · US20150188715

## Escopo (kernel)

- Grafo de nós com **EPID** (policy + parent)
- Herança de policy nula
- Enforcement em leitura: sem permissão → sem objeto e **sem count**
- Create admissions (authz antes de criar recurso)
- Audit: chain `previousSummaryHash → summaryHash`, verify, redact, detect tamper

## Fora deste passo

- Pods / K8s / ingress / vault launch (infra)
- Lineage colunar / redaction de grafo (Passo 27)
- GUI

## Uso

```bash
pnpm policy -- demo
pnpm --filter policy-engine test
```
