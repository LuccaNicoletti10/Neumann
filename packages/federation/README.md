# federation — Passo 31

Federation planner → pushdown query → fonte → representação temporária (TTL) → materialização opcional. **Sem copiar a fonte para o DatasetStore.** Sem GUI.

**Patentes:** US 10,402,397 · US 11,281,659 · US 11,681,690

## Escopo (kernel)

- Planner decompõe a query em `PushdownSpec` por fonte (`primaryKeys` / predicados só nos campos que a fonte tem)
- Connector com `capabilities: ['pushdown']` implementa `federatedQuery` — resultado `copied: false`
- Vista efêmera: `TemporaryObject` com `provenance: federated`, TTL de sessão, `copyOnWrite`
- ACL recuperada da fonte + redaction por principal/propriedade
- Promote opcional → `PlatformObject` (materialização copy-on-write; a fonte continua dona do registro)
- Edição da vista temporária (add/update property, add link) e link exibido mesmo ausente do store

## Gate T1.5

Consultar registro remoto **sem copiá-lo** para o store imutável: o objeto existe só como vista temporária; `snapshot()` da fonte não é chamado.

```bash
pnpm fed -- demo
pnpm --filter federation test
```

## Fora deste passo

- Edge/SCADA (Passo 32, só com fonte real)
- DuckDB físico / GUI de federação
- App vertical
