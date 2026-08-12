# data-lineage — Passo 15

Lineage por versão: toda `pipeline_run` grava `input_versions[] → output_version` + hash + duration; `upstream()` / `downstream()` / `fullProvenance()`; gate de completude 100%.

**Patentes:** US 9,996,595 · US 9,348,879 · US20140114907 · US20150012477 · US 10,027,551

## Escopo (kernel)

- Grafo: versões = nós, derivações = arestas
- Nós compostos (dataset → sub-entradas de versão) para visualização **serializada** (sem GUI)
- Dirty bit + propagação de invalidação
- Notificação mínima via callback `onChange`

## Fora deste passo

- Policy / EPID / `authorize()` → Passo 16
- Lineage colunar → Passo 27
- Spark/MapReduce / GUI

## Uso

```bash
pnpm lineage -- demo
pnpm --filter data-lineage test
```
