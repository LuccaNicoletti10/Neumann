# incremental-pipeline-scheduler

**Passo 12** — DAG de dependências + scheduler que, no commit de um input, reconstrói **somente** descendentes afetados (quando todos os inputs estão disponíveis).

Patente (forma funcional): **US 11,314,698**

## Escopo

| In | Out |
|---|---|
| RAW/DERIVED + edges + ciclo | SQL UI / code editor / front-end |
| arrival → subset dependents → build | RDD/Spark workers distribuídos |
| partial dependency (espera inputs) | Persistence ObjectOutputStream |
| cutoff full-build + critical notify | RMI / Thread.sleep wall-clock |
| groups metadata | Group wait semantics completas |

## Gate

```bash
pnpm ips -- demo
# R1 → [D1]; R2 → []; R3 → [D2,D4]; R4 → [D3,D5,D6]
```

```ts
import {
  createIncrementalPipelineScheduler,
  seedPatentFigure2b,
} from 'incremental-pipeline-scheduler';

const s = createIncrementalPipelineScheduler();
seedPatentFigure2b(s);
s.commitArrival('R1'); // rebuilds D1 only
```
