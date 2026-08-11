# inline-tag-sync

Editor de documentos com **tags in-line vinculadas a objetos** e **sincronização
bidirecional documento ↔ data object** entre duas plataformas. Reimplementação
**funcional independente e original** dos mecanismos da patente US 10,552,524 B1
(Palantir, "Systems and Methods for In-Line Document Tagging and Object-Based
Data Synchronization") — nenhum texto dos claims é reproduzido.

## Mecanismos implementados

1. **Documento com campos editáveis** — `title`, `summary` e `note`; o user
   input é associado a um campo, com operações de inserir/remover texto por
   offsets absolutos (`src/core/document.ts`).
2. **In-line tagging interface** — fluxo completo: selecionar trecho → buscar
   objetos relacionados (match do texto nas propriedades dos objetos) →
   escolher objeto → escolher PROPRIEDADE como tag → tag aplicada ao trecho
   (`applyFirstTag`). Alternativa: criar NOVO objeto/tag para o trecho
   (`createNewObjectFor`, "Create New Object for X").
3. **Atalho "@" durante a digitação** — `parseShortcut` localiza o user input
   `@texto`; `applyTagShortcut` **SUBSTITUI** o input pela tag selecionada
   (ícone + texto destacado): `@John Doe` → `Email: johndoe@email.com`, com a
   tag cobrindo exatamente o trecho substituído.
4. **Renderização diferenciada** — texto tagueado exibido de forma diferente
   do não-tagueado: marcador `[TAG:Tipo/Prop]texto[/TAG]` na visão in-line
   (`src/core/render.ts`).
5. **Data object** — `generateDataObject` gera, a partir das tags do documento
   (object-based data modeling framework), um data object na segunda
   plataforma (object store), carregando as first tags com localizações
   absolutas, campos, comentários e histórico; `generateObjectView` produz a
   "object view" exibida ao salvar. Regenerar **atualiza** o mesmo data object.
6. **Object-based interface** — trechos tagueados em negrito/sublinhado
   (`**__texto__**`); seleção de trecho tagueado mostra detalhes/propriedades
   do objeto (`renderTagDetails`); `applySecondTag` aplica "second document
   tags" e **ATUALIZA o data object E o documento** — as duas plataformas
   ficam sempre com todas as tags (`isSynchronized`).
7. **Re-edição sem deslocamento** — `reloadDocumentForEditing` carrega o
   documento a partir do data object, identifica as **localizações absolutas**
   das tags e remove todas elas; o texto pode ser editado livremente;
   `synchronizeEdits` re-aplica as tags **nas mesmas localizações absolutas**
   e sincroniza as edições com o data object.
8. **Colaboração** — tags e edições registram `userId`; `addEditComment`
   associa motivo/comentário (ex.: "aprovado para publicação") ao documento;
   histórico de revisões completo (`revisionHistory`), preservado no data
   object entre plataformas.

## Uso

```bash
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit (strict)
npm run build       # emite dist/

# CLI (dev)
npm run dev -- demo
npm run dev -- serve --port 8080

# CLI (build)
npm run build && node dist/cli.js demo
```

## Demo CLI

`inline-tag-sync demo` executa o fluxo completo de forma determinística:

1. cria o documento na primeira plataforma;
2. tagueia o trecho "John Doe" in-line (busca → objeto → propriedade);
3. digita `@John Doe` e o atalho substitui o input pela tag `Email: ...`;
4. gera o data object na segunda plataforma + object view;
5. aplica second tag pela object-based interface (sincronização);
6. recarrega do data object, edita sem deslocar tags e sincroniza;
7. registra comentário "aprovado para publicação" e exibe o histórico.

## Servidor HTTP

| Método | Rota                      | Descrição                                             |
| ------ | ------------------------- | ----------------------------------------------------- |
| GET    | `/health`                 | `{ "status": "ok" }`                                  |
| POST   | `/documents`              | Cria documento (`title`/`summary`/`note`/`userId`)    |
| POST   | `/objects`                | Cria objeto na segunda plataforma (`type`/`properties`) |
| POST   | `/tags/first`             | Aplica first tag in-line a um trecho                  |
| POST   | `/tags/shortcut`          | Atalho "@": substitui o input pela tag escolhida      |
| POST   | `/objects/search`         | Busca objetos por texto nas propriedades              |
| POST   | `/data-objects/generate`  | Gera/atualiza data object + object view               |
| POST   | `/tags/second`            | Second tag via object-based (sincroniza as plataformas) |
| POST   | `/sync/reload`            | Recarrega documento do data object (tags removidas)   |
| POST   | `/sync/finalize`          | Re-aplica tags nas localizações absolutas e sincroniza |

Corpo máximo: **8 MB** (413 com dreno do corpo). `startServer(0)` devolve a
porta efetiva em `port`.

## API

```ts
import {
  createDocument, createObjectStore, applyFirstTag, applyTagShortcut,
  generateDataObject, generateObjectView, applySecondTag,
  reloadDocumentForEditing, synchronizeEdits, addEditComment,
  renderInlineView, renderObjectBasedView, startServer, runCommandLine,
} from 'inline-tag-sync';
```

## Estrutura

- `src/core/` — tipos, documento, object store, tagging, data object, sync, render (núcleo puro)
- `src/server/` — servidor HTTP das plataformas (node:http puro)
- `src/cli.ts` — entrypoint da linha de comando (`demo`, `serve`)
- `tests/` — vitest

Requisitos: Node 20+, ESM, zero dependências de runtime. Determinismo total:
relógio e geradores de id injetáveis (defaults: instante fixo e contadores
`doc-1`, `tag-1`, ...).
