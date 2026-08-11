# external-content-exporter

Interface de **tagueamento para conteúdo externo** com bookmarklet, armazenamento
local e exportação para um *internal database system*. Reimplementação
**funcional independente e original** dos mecanismos da patente US 10,809,888 B2
(Palantir, "Systems and Methods for Providing a Tagging Interface for External
Content") — nenhum texto dos claims é reproduzido; apenas a funcionalidade é
reimplementada de forma original, em TypeScript puro (zero dependências de
runtime, ESM NodeNext, determinismo total).

## Mecanismos implementados

1. **BOOKMARKLET (passo 505)** — `src/core/bookmarklet.ts`: modelo de bookmark
   contendo comandos JavaScript, instalado na barra de bookmarks de qualquer web
   browser (browser-agnostic) por drag-and-drop, atalhos ou importação, com
   geração da URL `javascript:...`; alternativa de **plug-in** específico por
   browser (`createPlugin`).
2. **ACESSO A CONTEÚDO EXTERNO (passo 510)** — `src/core/content.ts`: conteúdo
   externo ao internal database system, servido por um server externo via
   network (transporte injetável), acessado (aberto ou modificado) por meio do
   web browser. Tipos: `web-page`, `document`, `pdf`, `audio`, `video`, `image`,
   `email`, `form`.
3. **ENHANCE DO BROWSER (passo 515)** — a ativação do bookmarklet (`activate`)
   melhora o browser exibindo a tagging interface; `enhanceLocalCopy`
   reescreve/modifica parte do código da página injetando marcação de suporte à
   seleção na cópia local do conteúdo.
4. **RECEPÇÃO DA TAG CRIADA (passo 520)** — `src/core/tagging.ts`: a tagging
   interface permite selecionar uma porção do conteúdo (texto, região de imagem,
   frame de vídeo, segmento de áudio) e cria a tag associada à porção tagueada;
   `modifyTag` altera título/tipo após a criação.
5. **ARMAZENAMENTO LOCAL (passo 525)** — `src/core/tagStore.ts`: a tag recebida
   fica no sistema externo (memória do electronic device ou cache do browser)
   numa **fila de pendentes**; o conteúdo externo é armazenado sob um **label**
   no cache/diretório associado à tagging interface.
6. **EXPORTAÇÃO (passo 530)** — `src/core/exporter.ts`: o botão de export
   ("Export to Internal DB") exporta tag + conteúdo para o banco interno e
   **exige login** (`src/core/auth.ts`, sessões com token determinístico);
   alternativa **AUTO-EXPORT** (`autoExportOnCreate`) em que a criação da tag
   dispara a exportação automática; conteúdo e tags podem permanecer no externo
   e ser exportados **depois**, quando o device conecta/loga (`flushPending`).
7. **CONVERSÃO + INTERNAL DATABASE SYSTEM** — `src/core/exporter.ts` +
   `src/core/internalDb.ts`: pares parâmetro-valor criados via API na ordem
   exata `TagOption`, `Title`, `Type`, `Content=<label>`, `DateAdded` (clock
   injetável), `User`; a interface de conversão (`convertToInternalFormat`)
   transforma pares + conteúdo no formato compatível; o banco interno armazena
   o conteúdo em **data sources** e os pares no **database** segundo a
   ontology/object model (`object` | `property` | `link`), com consulta por
   label.
8. **COMBINAÇÕES DE ARMAZENAMENTO** — externo, interno ou ambos
   (`StorageCombination`: `external` | `internal` | `both`, via
   `retainExternal`).

## Uso

```bash
npm install
npm test            # vitest (85 testes)
npm run typecheck   # tsc --noEmit (strict)
npm run build       # emite dist/

# CLI (dev)
npm run dev -- demo                 # fluxo completo: bookmarklet → acesso → enhance →
                                    # 2 tags → store local → login → export → flush
npm run dev -- serve --port 8080

# CLI (build)
npm run build && node dist/cli.js demo
```

## Demo CLI

external-content-exporter demo executa o fluxo do FIG. 5 de forma
determinística e imprime os recibos:

```text
bookmarklet "Exportar p/ DB interno" instalado (bookmarklet-1) → javascript:...
conteúdo externo acessado: content-1 (pdf) de externo.example.com
browser melhorado: tagging interface visível=true
conteúdo armazenado localmente sob label "content-1"
tags criadas e armazenadas localmente: tag-1, tag-2 (pendentes=2)
login efetuado: sessão session-1 (user=analyst)
recibo: tag=tag-1 conteúdo=content-1 pares=6 dataSource=datasource-1 registro=record-1 storage=internal em=2024-01-01T00:00:03.000Z
recibo: tag=tag-2 conteúdo=content-1 pares=6 dataSource=datasource-2 registro=record-2 storage=internal em=2024-01-01T00:00:04.000Z
demo concluído: pendentes=0 registros=2
```

## API

```typescript
import {
  createBookmarklet, createBookmarkBar, activate,
  createWebBrowser, accessExternalContent, enhanceLocalCopy, labelContent,
  createTaggingSession, createTagStore, createAuth, createExporter,
  createInternalDb, createDeterministicClock, createIdGenerator,
  toParameterValuePairs, convertToInternalFormat, startServer,
} from 'external-content-exporter';

const clock = createDeterministicClock();
const nextId = createIdGenerator();
const auth = createAuth({ clock, nextId });
const tagStore = createTagStore();
const internalDb = createInternalDb({ nextId });
const exporter = createExporter({ auth, tagStore, internalDb, clock });
// exportTag(token, tagId) exige login; flushPending(token) exporta a fila.
```

## Servidor HTTP

Corpo máximo: 8 MB (com dreno do corpo no 413). Token de sessão via header
x-session-token ou campo token do corpo. Sem sessão válida, as rotas de
exportação respondem 401 (LOGIN_REQUIRED).

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | /health | { "status": "ok" } |
| POST | /login | { user, password } → sessão (session-N); 401 em credenciais inválidas |
| POST | /logout | encerra a sessão do token |
| POST | /bookmarklets | { name, commands[] } → bookmarklet com URL javascript:... |
| POST | /sessions | { bookmarkletId, url } → ativa o bookmarklet: acessa o conteúdo externo, melhora a cópia local e abre a tagging interface |
| POST | /sessions/:id/tags | { tagOption, title, type, selection? } → tag criada (pendente ou auto-exportada) |
| POST | /export | { tagId, retainExternal? } → recibo de exportação (401 sem login) |
| POST | /export/flush | exporta toda a fila pendente após o login (401 sem login) |

## Determinismo

Proibido Date.now()/Math.random()/new Date() direto no núcleo:
DateAdded, createdAt e exportedAt vêm de um clock injetável
(createDeterministicClock, default a partir de 2024-01-01T00:00:00.000Z,
+1s por chamada) e todos os ids vêm de um gerador injetável com contadores
por prefixo (tag-1, content-1, session-1, ...).
## Estrutura

src/core/ — tipos, determinismo, bookmarklet, conteúdo, tagging, tag store,
auth, exporter, internal database (núcleo puro)
src/server/ — servidor HTTP da tagging interface (node:http puro)
src/cli.ts — entrypoint da linha de comando (runCommandLine puro/testável)
tests/ — vitest (85 testes cobrindo os 8 mecanismos)

Requisitos: Node 20+, ESM, zero dependências de runtime.
