# object-set

Recursive ObjectSet algebra for Neumann:

`BASE` · `FILTER` · `UNION` · `INTERSECT` · `SUBTRACT` · `STATIC` · `SEARCH_AROUND`

API shapes adapted from [OpenFoundry](https://github.com/Przyval/openfoundry) (Apache-2.0). Persistence is injected via `ObjectRepository` / `LinkRepository` — not copied from OpenFoundry's in-memory `/tmp` stores.

## Resolvers

- **Memory** (`resolveObjectSet`) — conformance oracle. Filters in-process.
- **PostgreSQL** (`createPgObjectSetResolver` / `resolveObjectSetPg`) — compiles the AST to one parameterized query. Filters push down to JSONB (`@>` GIN fast path for string `EQUALS`). `SEARCH_AROUND` is two joins, not N+1.

Gate: `pnpm gate:objectset-parity` (500 seeded ASTs, memory ≡ PG).

Ontology-guided `coerceFilter` / `coerceValue` run on the HTTP path: unknown property → 400; `?value=150` on a number property becomes numeric before compare.
