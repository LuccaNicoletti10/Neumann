# tagging-interface-panel

Painel de **tagging interface** exibido sobre conteúdo externo no browser
(bookmarklet/plugin), com auto-preenchimento de campos, tags de
objeto/propriedade/link, tagged objects field, busca e sincronização com
*internal database system* e exportação. Reimplementação **funcional
independente e original** dos mecanismos da publicação US 2014/0282121 A1
(Palantir, "Systems and Methods for Providing a Tagging Interface for External
Content") — nenhum texto dos claims é reproduzido.

## Mecanismos implementados

1. **Data fusion core** (`src/core/ontology.ts`, `parser.ts`, `fusion.ts`):
   ontologia com object types e property types (componentes, base type e
   vínculo *representative of* — ex.: "Social Security Number" representa
   "Person", não "Business"); parser definitions com regex symbology para
   propriedades compostas — "{LAST NAME}, {FIRST NAME}" aceita "Smith, Jane" e
   rejeita "Smith Jane", que por sua vez é aceito por "{FIRST NAME} {LAST
   NAME}"; schema map + transformation component convertendo data items de
   fontes externas em elementos do object model.
2. **Tagging interface (450)** (`src/core/panel.ts`): painel exibido por
   bookmarklet/plugin sobre o conteúdo externo no browser; o usuário pode
   precisar de login no internal database system antes de ativar operações
   protegidas (sync/export).
3. **Auto-preenchimento de campos** (`src/core/fields.ts`): ao selecionar uma
   porção do conteúdo, TITLE (412) e TYPE (410) são auto-preenchidos conforme
   o tipo do conteúdo (texto → TITLE = texto selecionado; TYPE inferido por
   regras determinísticas, ex.: "Curiosity" → "Ground Travel"); preenchimento
   manual, listas pull-down e TYPE modificável após a criação (ex.: "Ground
   Travel" → "Air Travel").
4. **Opções de tag + Create Tag button** (`src/core/options.ts`): property tag
   option (404) adiciona campo LINK_TO_OBJECT; link tag option (408) adiciona
   campos para vincular 2+ objetos ou 2+ propriedades; object tag option (406)
   usa os campos base; o Create Tag button (414) cria a tag associada à porção
   selecionada, com validações por opção.
5. **Tagged objects field (418)** (`src/core/taggedObjects.ts`): exibe todos
   os object tags criados associados ao conteúdo em um só lugar; permite
   modificar qualquer tag, selecionar um objeto para vincular property tag e
   selecionar 2+ objetos (ou 2+ propriedades, no tagged properties field) para
   link tag.
6. **Search for object field (416)** (`src/core/search.ts`): busca objetos já
   existentes no internal database (ex.: "Curiosity"); SYNC do objeto tagueado
   com o objeto existente (**login exigido**); criação de object/property
   types para entidades existentes.
7. **Pares parâmetro-valor + cache** (`src/core/pairs.ts`): a API coleta tags
   + conteúdo como pares parâmetro-valor (`TagOption`, `Title`, `Type`,
   `Content`, `DateAdded` vindo do clock injetável, `User`); o conteúdo
   externo é armazenado sob label em cache/diretório associado à interface
   (texto, representação e/ou dados audiovisuais).
8. **Export button (420)** (`src/core/panel.ts`): "Export to Internal DB"
   exporta conteúdo + tags criadas (**login exigido**), com combinações de
   destino (externo/interno/ambos), auto-export opcional ao clicar Create Tag
   e conversão para o formato do internal database.

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
O comando demo executa o fluxo completo no estilo do FIG. 4: seleciona
"Curiosity" → auto-fill TITLE/TYPE → object tag → tagged objects → property
tag vinculada → link tag entre 2 objetos → search + sync → export com os
pares parâmetro-valor impressos.
API
TypeScript
import { TaggingInterfacePanel, createDemoOntology, createStepClock } from 'tagging-interface-panel';

const panel = new TaggingInterfacePanel(createDemoOntology(), {
  clock: createStepClock('2014-09-18T12:00:00.000Z', 60_000),
  user: 'analista',
  loggedIn: true,
});
panel.select({ contentKind: 'text', content: '...', portion: 'Curiosity' });
panel.chooseOption('object');
const tag = panel.createTag();
Servidor HTTP
Table
Método	Rota	Descrição
GET	/health	{ "status": "ok" }
POST	/panel/select	Seleciona porção; auto-preenche TITLE/TYPE; cacheia o conteúdo
POST	/panel/options	Campos dinâmicos da opção (property/object/link)
POST	/panel/tags	Create Tag button (201)
GET	/panel/tagged-objects	Tagged objects field + tagged properties field
POST	/panel/search	Busca objetos existentes no internal database
POST	/panel/sync	SYNC do objeto tagueado (401 sem login)
POST	/panel/export	Export to Internal DB (401 sem login)
Corpo máximo: 8 MB (resposta 413 com dreno do corpo).
Estrutura
src/core/ — tipos, ontologia, parser, fusion, campos, opções, tagged
objects, busca, pares, painel (núcleo puro, determinístico)
src/server/ — API HTTP do painel (node:http puro)
src/cli.ts — entrypoint da linha de comando (demo, serve)
tests/ — vitest
Determinismo total: sem Date.now()/Math.random(); DateAdded vem do clock
injetável e os ids são contadores por prefixo. Requisitos: Node 20+, ESM, zero
dependências de runtime.
