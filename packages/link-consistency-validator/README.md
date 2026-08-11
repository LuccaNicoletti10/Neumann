# link-consistency-validator

Validador de consistência de links entre um **script de transformação** (escrito num **builder DSL** próprio) e **parâmetros de ontologia**. Implementação funcional **independente e original** dos mecanismos da patente **US 8,930,897 B2** (Palantir/Nassar, *"Data Integration Tool"*) — nenhum texto dos claims é copiado; os mecanismos foram reimplementados do zero.

## Mecanismos implementados

1. **Transformation script com builder DSL** — a DSL (`src/core/dsl.ts`) permite:
   - `object Pessoa` — definir entidade como **objeto**;
   - `property Pessoa.nome: string` — definir entidade como **propriedade** de objeto;
   - `link Pessoa --trabalha_em--> Empresa` — **criar link** entre duas entidades;
   - `condition c1 Pessoa --trabalha_em--> Empresa uses csv-1` — condição de depuração que usa um **data item importado**.
2. **Ontology parameters** (`src/core/ontology.ts`) — modelo JSON que **atribui** entidades (objeto/propriedade) e **atribui links** entre duas entidades (ex.: `Pessoa --trabalha_em--> Empresa`).
3. **Data source com data items** (`src/core/data-source.ts`) — importação de data items de **CSV estruturado** e de **texto não estruturado** com extrator por regex configurável.
4. **Debugging operation** (`src/core/validator.ts`) — itera as condições do script (mínimo uma). Uma condição é **inválida** quando:
   - o link **atribuído** na ontologia é **inconsistente** com o link **criado** no builder (direção invertida, predicado divergente ou ausente);
   - a **atribuição da entidade** na ontologia (objeto vs propriedade) é inconsistente com a **definição** no builder;
   - o data item usado pela condição não foi importado, ou o builder não criou o link da condição.
5. **Resultado expressed vs implicit** — condição inválida → **EXPRESSED** (mensagem no *display device* abstrato injetável); válida com condições subsequentes → **IMPLICIT** (silencioso); válida e última → **EXPRESSED** `"transformation script has been validated"`.

## Requisitos

Node.js 20+. ESM, TypeScript strict, **zero dependências de runtime** (devDeps: `@types/node`, `tsx`, `typescript`, `vitest`).

## Uso

```bash
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # emite dist/
```

### Biblioteca

```typescript
import {
  ScriptBuilder, Ontology, ScriptValidator,
  CollectingDisplayDevice, importDataItems,
} from 'link-consistency-validator';

const builder = ScriptBuilder.fromDsl(`
object Pessoa
object Empresa
link Pessoa --trabalha_em--> Empresa
condition c1 Pessoa --trabalha_em--> Empresa uses csv-1
`);
const ontology = Ontology.fromJson({
  links: [{ from: 'Pessoa', predicate: 'trabalha_em', to: 'Empresa' }],
});
const items = importDataItems({ type: 'csv', content: 'nome\nAna' });
const display = new CollectingDisplayDevice();
const results = new ScriptValidator(ontology, display).debug(builder, items);
// results[0].kind === 'expressed', message === 'transformation script has been validated'
```

### CLI

```bash
npm run cli -- validate --script script.dsl --ontology ont.json --data dados.csv [--format text|json]
npm run cli -- parse script.dsl
npm run cli -- demo                    # script + ontologia com link inconsistente embutidos
npm run cli -- serve --port 3000
```

### Servidor HTTP (somente node:http)

```typescript
import { startServer } from 'link-consistency-validator/server';
const { port, close } = await startServer(3000);
```

- `GET /health` → `{"status":"ok"}`
- `POST /validate` — corpo `{ "script": "...", "ontology": {...}, "dataSource": { "type": "csv", "content": "..." } }` → `{ results, displayed }`
- `POST /parse-dsl` — corpo `{ "script": "..." }` → script parseado ou erro de sintaxe com a linha
- Limite de corpo: 8 MB (`MAX_BODY`).

## Exemplo de inconsistência detectada

Builder cria link `Pessoa --emprega--> Empresa`, mas a ontologia atribui
`{ from: 'Empresa', predicate: 'emprega', to: 'Pessoa' }` (direção invertida) → a condição é inválida e o resultado é EXPRESSED:

```
condição "c2" (linha 9) não é válida: link atribuído na ontologia (...) é inconsistente com o link criado no builder (...): direção invertida ou predicado divergente
```

## Determinismo e testabilidade

Sem `Date.now`/`Math.random` na lógica; o display device (`DisplayDevice`) e os canais da CLI (`CliIO`) são interfaces injetáveis — os testes capturam a saída em memória.

## Licença

MIT.
