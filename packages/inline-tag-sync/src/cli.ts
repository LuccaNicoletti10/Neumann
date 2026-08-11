#!/usr/bin/env node
/**
 * inline-tag-sync — src/cli.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * ENTRYPOINT DA LINHA DE COMANDO — `runCommandLine(argv, deps)` puro e
 * testável (stdout injetável) com o comando `demo`, que executa o fluxo
 * completo: criar documento → taguear trecho in-line → atalho "@" → gerar
 * data object → second tag via object-based → reload/re-edição sem
 * deslocamento → sincronização → comentário e histórico. Também expõe
 * `serve` para subir o servidor HTTP. Nenhum texto dos claims é reproduzido;
 * apenas a funcionalidade é reimplementada de forma original.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateDataObject, generateObjectView } from './core/dataObject.js';
import { createDocument, getField, insertText } from './core/document.js';
import { createObjectStore } from './core/objectStore.js';
import {
  renderInlineView,
  renderObjectBasedView,
  renderTagDetails,
} from './core/render.js';
import {
  addEditComment,
  applySecondTag,
  editSessionField,
  isSynchronized,
  reloadDocumentForEditing,
  revisionHistory,
  synchronizeEdits,
} from './core/sync.js';
import { applyFirstTag, applyTagShortcut, searchForSelection } from './core/tagging.js';
import { startServer } from './server/index.js';

const USAGE = `inline-tag-sync — documentos tagueados in-line sincronizados com data objects

Uso:
  inline-tag-sync demo
  inline-tag-sync serve [--port <n>]
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

function portFromFlags(args: readonly string[]): number | undefined {
  const index = args.indexOf('--port');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port deve ser um inteiro entre 0 e 65535');
  }
  return port;
}

/** Executa a demonstração determinística do fluxo completo das duas plataformas. */
function runDemo(log: (message: string) => void): number {
  // Segunda plataforma (object store) semeada com objetos relacionados.
  const store = createObjectStore();
  const perfil = store.createObject({
    id: 'obj-perfil-john',
    type: 'Person',
    properties: {
      name: "John Doe's Profile",
      email: 'johndoe@email.com',
      role: 'Analista',
    },
    createdBy: 'ana',
  });
  const news = store.createObject({
    id: 'obj-local-news',
    type: 'Article',
    properties: { title: 'Local News', topic: 'Comunidade' },
    createdBy: 'ana',
  });

  log('== 1. Documento criado na primeira plataforma ==');
  const doc = createDocument({
    id: 'doc-1',
    title: 'Relatório semanal',
    summary: 'Cobertura pelo Local News.',
    note: 'Contato: John Doe esteve no evento.',
    userId: 'ana',
  });
  log(`documento "${doc.id}" criado por ana (campos: title, summary, note)`);

  log('== 2. In-line tagging: selecionar trecho → buscar → escolher objeto+propriedade ==');
  const noteText = getField(doc, 'note').text;
  const start = noteText.indexOf('John Doe');
  const end = start + 'John Doe'.length;
  const results = searchForSelection(doc, 'note', start, end, store);
  for (const result of results) {
    log(`  resultado: ${result.label} [${result.type}] (${result.matchedProperty})`);
  }
  const tag1 = applyFirstTag(
    doc,
    { field: 'note', start, end, objectId: perfil.id, propertyKey: 'name', userId: 'ana' },
    store,
  );
  log(`  first tag ${tag1.id} aplicada: "${tag1.label}" em note[${start}, ${end})`);

  log('== 3. Atalho "@" durante a digitação (replacing do user input pela tag) ==');
  insertText(doc, 'note', getField(doc, 'note').text.length, ' Enviar para @John Doe', 'ana');
  const shortcut = applyTagShortcut(
    doc,
    'note',
    { objectId: perfil.id, propertyKey: 'email', userId: 'ana' },
    store,
  );
  log(`  "@${shortcut.match.query}" substituído por "${shortcut.tag.label}"`);
  log('--- visão in-line (tags com marcador, texto comum sem) ---');
  log(renderInlineView(doc, store));

  log('== 4. Data object gerado na segunda plataforma + object view ==');
  const dataObject = generateDataObject(doc, store);
  log(`  data object "${dataObject.id}" [${dataObject.type}] carrega ${doc.tags.length} tag(s)`);
  const view = generateObjectView(doc, store);
  for (const entry of view.entries) {
    log(
      `  object view: ${entry.tagId} → ${entry.objectLabel}/${entry.propertyKey} ` +
        `= "${entry.propertyValue}" (trecho: "${entry.text}")`,
    );
  }

  log('== 5. Second tag via OBJECT-BASED interface (atualiza objeto E documento) ==');
  const summaryText = getField(doc, 'summary').text;
  const sStart = summaryText.indexOf('Local News');
  const sEnd = sStart + 'Local News'.length;
  const second = applySecondTag(
    doc,
    {
      field: 'summary',
      start: sStart,
      end: sEnd,
      objectId: news.id,
      propertyKey: 'title',
      userId: 'bruno',
    },
    store,
  );
  log(`  second tag ${second.tag.id} (object-based, por bruno) → data object atualizado`);
  log('--- visão object-based (trechos tagueados em negrito/sublinhado) ---');
  log(renderObjectBasedView(doc, store));
  log('--- detalhes do trecho tagueado selecionado ---');
  log(renderTagDetails(doc, second.tag.id, store));

  log('== 6. Re-edição SEM deslocamento: reload → tags removidas → editar → re-aplicar ==');
  const session = reloadDocumentForEditing(second.dataObject.id, store);
  log(
    `  ${session.absoluteLocations.length} localização(ões) absoluta(s) identificada(s); ` +
      `tags do documento da sessão: ${session.document.tags.length} (removidas)`,
  );
  editSessionField(
    session,
    'note',
    `${getField(session.document, 'note').text} Atualizado.`,
    'ana',
  );
  const synced = synchronizeEdits(session, store);
  log(`  tags re-aplicadas nas localizações absolutas: ${synced.document.tags.length}`);
  log(`  documento ↔ data object sincronizados: ${isSynchronized(synced.document, store)}`);

  log('== 7. Colaboração: comentário de edição + histórico de revisões ==');
  addEditComment(synced.document, 'bruno', 'aprovado para publicação');
  log(`  comentário registrado: "${synced.document.comments[0]?.text ?? ''}" (bruno)`);
  for (const revision of revisionHistory(synced.document)) {
    log(`  rev ${revision.id} [${revision.action}] ${revision.userId}: ${revision.detail}`);
  }
  return 0;
}

/** Ponto de entrada programático da CLI (testável, sem process.exit). */
export async function runCommandLine(
  argv: readonly string[] = [],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m: string): void => console.log(m));
  const error = deps.error ?? ((m: string): void => console.error(m));
  const args = argv.filter((a) => a !== '--');
  const [command, ...rest] = args;
  try {
    switch (command) {
      case 'demo':
        return runDemo(log);
      case 'serve': {
        const port = portFromFlags(rest) ?? 8080;
        const started = await startServer(port);
        log(
          `inline-tag-sync ouvindo em http://localhost:${started.port} ` +
            '(GET /health, POST /documents, /tags/*, /objects/*, /data-objects/generate, /sync/*)',
        );
        return 0;
      }
      case undefined:
        log(USAGE);
        return 0;
      default:
        error(USAGE);
        return 2;
    }
  } catch (err) {
    error(`erro: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

function isDirectRun(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
