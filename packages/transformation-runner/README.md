# transformation-runner

**Passo 11** — DSL de transformações + SQL versionado + gate de determinismo.

Patentes (forma funcional, não Java literal):
- US 9,576,015 / US 9,965,534 / US20170068698A1 — DSL (`newTable` / `startWith` / `transformation` / `privateTable` / custom)
- US 9,922,108 / US 10,776,382 — pipeline tabular → dataset transformado

## Escopo

| In | Out (Passos depois / Bloco 6) |
|---|---|
| filter/join/sort/aggregate/drop/rename/distinct/select/custom | GUI / visualization templates |
| TableDefinition + DAG linear | privateTable multi-programa (usa Passo 12) |
| Incremental analysis + CONCATENATE | Scheduler DAG full (Passo 12) |
| SQL versionado (DuckDB dialect) | Binary DuckDB nativo no CI |
| Memory executor (hash gate) | Marketplace / DataExchange |

DuckDB: o programa materializa SQL determinístico; o executor kernel é memória. Stub `engine: 'duckdb'` delega ao memory — plug-in nativo é upgrade.

## Uso

```bash
pnpm --filter transformation-runner test
pnpm xform -- demo
# aliases: tr
```

```ts
import { createTransformationRunner } from 'transformation-runner';

const r = createTransformationRunner();
r.registerTable({ name: 'orders', columns: ['id', 'status'], rows: [...] });
const def = r.dsl.newTable('active');
r.dsl.startWith(def, 'orders');
r.dsl.transformation(def, 'filter', { column: 'status', values: ['active'] });
const prog = r.build(def);
const { contentHash, rows } = r.run(prog);
```
