# offline-sync — Passo 34

Snapshot autorizado local → disconnect → mutations locais → reconnect → conflict detector → resolution → estado convergido. **Sem GUI.** Sem ingest privilegiado.

**Patentes:** US 8,515,912 · US 9,569,070 · US 8,364,642 · US 8,812,444 · US 9,275,069

## Escopo (kernel)

- Multimaster com **version vectors**: apply / discard / conflict; resolução `acceptLocal` | `acceptPeer` | `merge`
- Catálogo de conflitos ambíguos (tipo, título, foto, deleção, geotime, resolução) + filtro/grupo + **resolve em lote** (view-model, não UI)
- Investigação desconectada: `.base` (snapshot + change sets) / `.dsco` (resultados); update com os mesmos objetos (claim 1) ou objetos adicionais (claim 7)
- Snapshot autorizado = só o que o principal vê (ACL no objeto)

## Gate

Rede estabilizou → `authorized_state(A) == authorized_state(B)` na porção compartilhável. Testado com partition + reorder + duplicate + drop + 3+ réplicas.

```bash
pnpm offline -- demo
pnpm --filter offline-sync test
```

## Fora deste passo

- Replicação cross-ACL (Passo 33)
- GUI de deconflição
- App vertical
