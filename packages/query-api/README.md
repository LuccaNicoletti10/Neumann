# query-api — Passo 29

Query API + índice permission-aware. Planner escolhe backend (`search-index` / `object-store` / `graph` / `federation`). ACL e classificação no documento; as 6 superfícies (hit, autocomplete, facet, suggestion, snippet, ranking) só veem o conjunto autorizado.

**Patentes:** US 9,031,981 · US 9,798,768 · US 8,868,537 · US 9,262,529 · US 10,726,032 · US 9,619,557 · US 8,041,714 / US 8,280,880 · US 11,238,102

## Escopo (kernel)

- Documento de índice: `aclPrincipals[]` + `classification` + `propertyClassifications` (fail-closed)
- Filtro no índice (token só conta se a propriedade for visível) + pós-checagem
- Search Around = 1 hop no knowledge-graph com `viewingLevel`
- Templates = `ObjectSetFilter` parametrizado (`$status`)
- Filter chain = AST `AND/OR/NOT/EQUALS/CONTAINS/…`
- NL = parse estruturado (`type:ot.customer status=open acme`) — sem LLM
- Freshness = `indexedAt − sourceUpdatedAt`

Meilisearch é o sidecar de escala (mesmo shape de documento). O gate corre no índice in-memory — não exige Docker.

## Fora deste passo

- GUI visual / XML de query
- App vertical / Meilisearch obrigatório nos testes

## Uso

```bash
pnpm search -- demo
pnpm --filter query-api test
```
