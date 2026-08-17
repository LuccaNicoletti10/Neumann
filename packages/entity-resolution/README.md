# entity-resolution (Passos 20–22)

Pipeline **normalização → blocking → scoring** (soft clusters) + **auditoria persistida + canonical merge reversível + fingerprint search** + **gold set / métricas / fila de revisão**.

- **US 8,554,719 / 9,501,552 / 9,846,731** — criteria / linking terms / exact·fuzzy·no-conflict
- **US 12,229,154** — soft resolution + confidence
- **US20140280252** — slug + bin blocking (nunca O(n²))
- **US20250165857A1** — comparar incoming vs entidades da ontology + feedback de review
- **US 12,393,406 / US20250348288A1** — k-gram + winnow fingerprint search (texto de entidade)
- **US 8,788,405 / US 8,818,892** — clusters + ranking da fila de revisão

```bash
pnpm er -- demo
# aliases: resolve / entity-resolution
```

Gate Passo 20: `"ACME LTDA"` + `"Acme Ltda."` → 1 cluster `ot.customer`.  
Gate Passo 21: toda decisão auditável; false merge reversível (unmerge restaura o source sem apagar originais).  
Gate Passo 22: 50 pares rotulados; precision/recall/F1/false-merge-rate documentado; `GET /api/v2/er/review-queue` + `POST /api/v2/er/review`.
