# entity-resolution (Passo 20)

Pipeline **normalização → blocking → scoring** (soft clusters).

- **US 8,554,719 / 9,501,552 / 9,846,731** — criteria / linking terms / exact·fuzzy·no-conflict
- **US 12,229,154** — soft resolution + confidence
- **US20140280252** — slug + bin blocking (nunca O(n²))

```bash
pnpm er -- demo
# aliases: resolve / entity-resolution
```

Gate: `"ACME LTDA"` + `"Acme Ltda."` → 1 cluster `ot.customer`.

Passo 21 = auditoria `entity_matches` + canonical merge; Passo 22 = gold set + review.
