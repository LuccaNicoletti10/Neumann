# observability

Instrumentacao compartilhada **pino + OpenTelemetry** para o NEUMANN BLOCO 1 / PASSO 2.

Todo request HTTP instrumentado emite log estruturado com:

| Campo | Descricao |
| --- | --- |
| `trace_id` | ID de trace (OTel ou hex gerado) |
| `principal` | Ator (`user:<id>`, `service:<id>` ou `anonymous`) |
| `tenant_id` | Tenant do request |
| `service` | Nome do servico |
| `version` | Versao do deployment |
| `deployment_id` | Identificador do deployment |
| `operation` | Metodo + rota (`GET /health`) |
| `duration_ms` | Latencia em ms |
| `result` | `ok` \| `error` \| `denied` |

Patentes relacionadas: **US 11,681,606** (logging automatico), **US 11,870,666** (metricas de uso).

## Gate TM0.5

O harness exige **100%** dos logs de request com todos os campos acima preenchidos.

```bash
npm run build
npm test                 # vitest: gate.test.ts + logger.test.ts
npm run cli -- check     # boot servidor, 20 requests mistos, assert coverage
```

Saida esperada do `check`:

```json
{
  "gate": "TM0.5",
  "coverage": { "total": 20, "complete": 20, "incomplete": 0 },
  "pass": true
}
```

## Uso rapido

### Servidor demo

```bash
npm run serve -- --port 3000
# GET  /health
# GET  /echo        (requer header X-Principal-Id)
# POST /work        (body JSON opcional: { "fail": true, "deny": true })
```

Headers uteis:

- `X-Principal-Id` — identifica o ator
- `X-Tenant-Id` — tenant (default `default` em rotas publicas)
- `X-Correlation-Id` — correlacao opcional no log

Export OTLP (Jaeger via OTLP):

```bash
npm run cli -- serve --port 3000 --otlp-url http://localhost:4318/v1/traces
```

### Integrar em Fastify

```typescript
import Fastify from 'fastify';
import {
  createRootLogger,
  registerObservabilityPlugin,
  LogCapture,
} from 'observability';

const app = Fastify({ logger: false });
const capture = new LogCapture();

await registerObservabilityPlugin(app, {
  identity: {
    service: 'my-api',
    version: '1.2.3',
    deploymentId: process.env.DEPLOYMENT_ID ?? 'local',
  },
  rootLogger: createRootLogger(
    { service: 'my-api', version: '1.2.3', deploymentId: 'local' },
    {},
    capture.destination,
  ),
});
```

## Scripts

| Script | Descricao |
| --- | --- |
| `npm run build` | Compila `src/` → `dist/` |
| `npm test` | Roda gate TM0.5 + testes de logger |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run cli` | CLI (`serve`, `check`) |

## Requisitos

- Node.js 20+
- TypeScript 5.5.4 (pinned)
- ESM (`"type": "module"`, `moduleResolution: NodeNext`)
