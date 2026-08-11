# entity-assignment-debugger

Depurador de atribuição de entidades — implementação funcional independente dos mecanismos da patente US 9,984,152 B2 (Data Integration Tool).

Node.js 20+ · ESM · TypeScript strict (noUncheckedIndexedAccess, noImplicitOverride, NodeNext) · zero dependências de runtime.

## Requisitos

```bash
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit (strict)
npm run build       # emite dist/
```

## Instalação e uso

### API

```typescript
import {
  TransformationBuilder, Ontology, CsvDataSource,
  ScriptDebugger, MemoryDisplayDevice,
} from 'entity-assignment-debugger';

const script = new TransformationBuilder('exemplo')
  .defineObject('Pessoa', { nome: 'string' })
  .defineProperty('Endereco', { owner: 'Pessoa', valueType: 'string' })
  .addMapping({ dataItemField: 'nome', entity: 'Pessoa', parameter: 'nome', dataItemId: 'row-1' })
  .addCondition({ id: 'c1', entity: 'Endereco', dataItemId: 'row-1' })
  .build();

const ontology = new Ontology([
  { kind: 'object', name: 'Pessoa', properties: { nome: 'string' } },
  { kind: 'property', name: 'Endereco', owner: 'Pessoa', valueType: 'string' },
]);

const display = new MemoryDisplayDevice();
const report = new ScriptDebugger(display).run(
  script, ontology, new CsvDataSource('nome\nAda\n'),
);
// report.success === true; display.messages === ['transformation script has been validated']
```

### CLI

```bash
# demo do mecanismo central: ontologia atribui "Endereco" como objeto enquanto o
# builder o define como propriedade → invalid expressed; corrigida → validated
npx tsx src/cli.ts demo

npx tsx src/cli.ts debug --script s.json --ontology o.json --data d.csv \
  [--format csv|json|text] [--delimiter ','] [--pattern 'REGEX com (?<grupos>)']

npx tsx src/cli.ts check-ontology --script s.json --ontology o.json
npx tsx src/cli.ts serve --port 8080
```

### Servidor HTTP (node:http puro)

- `GET /health` → `{ "status": "ok" }`
- `POST /debug` → corpo `{ script, ontology, dataSource }` → `{ success, outcomes, displayed }`
- `POST /ontology/check` → corpo `{ script, ontology }` → consistência por entidade e por link

Corpo máximo: 8 MB (`MAX_BODY`); `startServer(0)` retorna a porta efetiva.

## Determinismo

A lógica não usa `Date.now`/`Math.random`; o `DisplayDevice` é injetável e capturável em testes (`MemoryDisplayDevice`).
