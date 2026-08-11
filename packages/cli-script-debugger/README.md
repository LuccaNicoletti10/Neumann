# cli-script-debugger

Depurador de *transformation scripts* via **linha de comando**, com associação a
*ontology parameters*. Reimplementação **funcional independente e original** dos
mecanismos da patente US 11,100,154 B2 (Palantir/Nassar, "Data Integration
Tool") — nenhum texto dos claims é reproduzido.

## Mecanismos implementados

- **Debug via CLI**: a operação de debug é iniciada executando o script pela
  linha de comando (`runCommandLine(argv)`, puro e testável, sem `process.exit`).
- **Associação via config**: `debug.config.json` identifica o ontology file
  (`{ "ontologyFile": "./ontologia.json" }`); caminhos relativos são resolvidos
  em relação ao próprio config.
- **Associação lazy**: alternativa em que a associação script ↔ ontologia
  acontece **durante** o debugging (resolvida no primeiro uso, com cache).
  Ambos os modos — `eager` (via config, antes do run) e `lazy` — são suportados.
- **Núcleo de validação**: builder define entidades como OBJETO ou PROPRIEDADE
  de objeto; a ontologia atribui entidades; o script mapeia data items a
  ontology parameters; importação de data source estruturada (CSV) ou não
  estruturada (texto); condições baseadas no data source; o debugging determina
  condição inválida com base nos ontology parameters (atribuição inconsistente
  com a definição, mapping incompatível, condição não mapeada/incompatível).
- **Indicação do resultado**: `implicit` (válido) ou `expressed` (inválido),
  nas formas *error message*, *acronym*, *number* e *graphic*, entregues via
  notificação de debugger application, email ou popup window (sinks injetáveis).

## Requisitos

Node.js 20+. ESM, TypeScript strict, **zero dependências de runtime**
(devDeps: `@types/node`, `tsx`, `typescript`, `vitest`).

## Uso

```bash
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit (strict)
npm run build       # emite dist/

# CLI (dev)
npm run dev -- init-config
npm run dev -- debug --config debug.config.json --mode lazy
npm run dev -- demo
npm run dev -- serve --port 8080

# CLI (build)
npm run build && node dist/cli.js debug --config debug.config.json
```

## API

```typescript
import { runCommandLine, startServer, Validator, createScriptBuilder } from 'cli-script-debugger';

const result = runCommandLine(['debug', '--config', 'debug.config.json'], {
  sinks: [{ channel: 'debugger', deliver: (i) => console.log(i.content) }],
});
// result: { exit, verdict, indications, errors }
```

## Servidor HTTP

- `GET /health` → `{ "status": "ok" }`
- `POST /debug` → corpo JSON com `script`/`scriptFile`, `ontology`/`ontologyFile`,
  `data`/`dataFile`, `dataFormat` (`csv`|`text`), `mode` (`eager`|`lazy`) e
  `form`. Corpo máximo: 8 MB. Responde `{ verdict, indication }`.

## Estrutura

- `src/core/` — tipos, builder, ontologia, config, validator, indicação, runner (núcleo puro)
- `src/server/` — debugger application HTTP (`node:http` puro)
- `src/cli.ts` — entrypoint da linha de comando
- `tests/` — vitest
