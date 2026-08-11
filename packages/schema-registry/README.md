# schema-registry

**PASSO 7** — Schema Registry + classificador de drift + descoberta automática
de schema (US 9,330,120). TypeScript puro, zero dependências de runtime, ESM,
determinismo total (clock + ids injetáveis).

## O que faz

1. **Registry** — `source` / `object` / `column` / `physicalType` / `semanticHint` /
   `nullable` / `isPrimaryKey` / `foreignKeys[]` / `observedValuesSample` /
   `firstSeen` / `lastSeen` / `schemaVersion`.
2. **Classificador de drift (gate T1.4)** — `compatible` | `coercible` |
   `breaking` | `unknown`, com ação definida:
   - **compatible** (coluna nullable nova / nullability relaxada) → aceita + bump de versão
   - **coercible** (widening INT→FLOAT etc.) → aceita + registra cast + bump
   - **breaking** / **unknown** → **pausa a fonte** + abre alerta (nunca engole a mudança)
3. **Discover (US 9,330,120)** — infere schema de amostras (rows/CSV): tipos,
   hints (`email`/`phone`/`url`), PK heurística; **suggestMappings** ranqueia
   coluna → propriedade da ontologia (backend da importação assistida).

> O Python/tkinter colado na spec é a referência funcional da patente. Neste
> monorepo o backend é TypeScript (mesmo padrão dos demais pacotes); a UI visual
> fica para M6.

## Uso

```bash
pnpm --filter schema-registry test
pnpm --filter schema-registry typecheck
pnpm --filter schema-registry build
pnpm sr -- demo
```

## API

```ts
import {
  createSchemaRegistry, discover, parseCsvSample,
  classifyDrift, suggestMappings, createDemoOntology,
} from 'schema-registry';

const registry = createSchemaRegistry();
const observed = discover({ source: 'crm', object: 'people', rows });
registry.register(observed);
const { report, schema, alert } = registry.observe(nextObserved);
```

## HTTP

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | ok |
| GET | `/schemas` | lista schemas (`?source=`) |
| GET | `/alerts` | alertas de drift |
| POST | `/schemas/register` | registra schema inicial |
| POST | `/schemas/observe` | classifica drift + aplica resposta |
| POST | `/schemas/resume` | reativa fonte pausada |
| POST | `/discover` | `{ source, object, rows\|csv }` |
| POST | `/mappings/suggest` | sugestões schema→ontologia |

Corpo máximo: **8 MB** (413 com dreno).
