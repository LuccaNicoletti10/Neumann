# connector-postgres

Primeiro connector real (Passo 6):

- `snapshot()` — scan paginado `ORDER BY pk ASC`
- `read(cursor)` — polling `updated_at` (+ tombstones via `deleted_at`)
- cursor opaco + checkpoint persistente
- **Gate T1.3** — matar no evento 10.000, reiniciar, continuar sem dupes/skips

Usa `SqlClient` injetável; testes usam `createMemorySqlClient` (sem Docker).

```bash
pnpm --filter connector-postgres test
pnpm cpg -- demo
pnpm cpg -- gate-t1.3
```
