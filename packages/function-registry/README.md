# function-registry (Passo 23)

Camada **cinética** pura: `f(objects) → result`. Nunca altera estado.

Built-ins: `scoreRecord`, `aggregateMetrics`, `deriveFlags` — versionadas, testáveis, invocáveis via `POST /api/v2/ontologies/{id}/functions/{apiName}/execute`.

```bash
pnpm fn -- demo
```

Gate: function pura, versionada, invocável via API. Mutação de inputs → rejeitada.
