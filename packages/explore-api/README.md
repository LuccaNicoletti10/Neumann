# explore-api — Passo 30

APIs de exploração genéricas sobre a Ontology: padrão de grafo, índice em blocos, scoring ponderado e path de rich objects. **Sem app vertical e sem GUI.**

**Patentes:** US 8,799,240 · US 9,639,580 · US 9,280,532 · US 9,880,993

## Escopo (kernel)

- `GraphPattern` (nós + arestas + opcional/OR) compilado contra objetos/links; ACL no hop
- Investigação em larga escala: parse/transform → famílias chave-valor → busca 1 e 2 níveis (US 8,799,240)
- Scoring ponderado de objetos por métricas de propriedade (US 9,639,580) — tabela/rank, sem mapa
- Slot + `object.property` + autocomplete de propriedades visíveis + reavaliação (US 9,280,532)
- Projeção de propriedades (US 9,880,993)

## Fora deste passo

- App em `apps/` / UI de negócio / spreadsheet / mapa geográfico
- Meilisearch, Jest, `uuid`, LLM

## Uso

```bash
pnpm explore -- demo
pnpm --filter explore-api test
```
