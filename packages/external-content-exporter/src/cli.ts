#!/usr/bin/env node
/**
 * external-content-exporter — src/cli.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: ENTRYPOINT DA LINHA DE
 * COMANDO — runCommandLine(argv, deps) puro e testável (stdout injetável, sem
 * process.exit), com o comando `demo` que executa o fluxo completo (instala o
 * bookmarklet → acessa conteúdo externo → enhance do browser → cria 2 tags →
 * armazena localmente → login → export → flush da fila pendente) e imprime os
 * recibos, além do comando `serve`. Nenhum texto dos claims é reproduzido;
 * apenas a funcionalidade é reimplementada de forma original.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createAuth } from './core/auth.js';
import { activate, createBookmarkBar, createBookmarklet } from './core/bookmarklet.js';
import {
  accessExternalContent,
  createWebBrowser,
  enhanceLocalCopy,
  labelContent,
} from './core/content.js';
import { createDeterministicClock, createIdGenerator } from './core/determinism.js';
import { createExporter } from './core/exporter.js';
import { createInternalDb } from './core/internalDb.js';
import { createTaggingSession } from './core/tagging.js';
import { createTagStore } from './core/tagStore.js';
import type { ExportReceipt } from './core/types.js';
import { startServer } from './server/index.js';

const USAGE = `external-content-exporter — tagging interface para conteúdo externo

Uso:
  external-content-exporter demo
  external-content-exporter serve [--port <n>]
`;

/** Dependências injetáveis da CLI (stdout/stderr na borda). */
export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

/** Resultado puro da linha de comando (sem process.exit). */
export interface CommandResult {
  exitCode: number;
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

function printReceipt(log: (message: string) => void, receipt: ExportReceipt): void {
  log(
    `recibo: tag=${receipt.tagId} conteúdo=${receipt.contentLabel} ` +
      `pares=${receipt.pairCount} dataSource=${receipt.dataSourceId} ` +
      `registro=${receipt.recordId} storage=${receipt.storage} em=${receipt.exportedAt}`,
  );
}

/**
 * Comando `demo`: executa o fluxo completo da patente de forma determinística
 * e imprime cada etapa com os recibos de exportação.
 */
function runDemo(log: (message: string) => void): number {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();

  // 1. BOOKMARKLET: criado e instalado na barra de bookmarks do web browser.
  const bookmarklet = createBookmarklet(
    'Exportar p/ DB interno',
    ['exibirTaggingInterface()', 'habilitarSelecaoDePorcao()'],
    { nextId },
  );
  const bar = createBookmarkBar();
  bar.install(bookmarklet, 'drag-and-drop');
  log(`bookmarklet "${bookmarklet.name}" instalado (${bookmarklet.id}) → ${bookmarklet.url}`);

  // 2. ACESSO: conteúdo externo servido por server externo, aberto no browser.
  const browser = createWebBrowser();
  const content = accessExternalContent(browser, 'https://externo.example.com/relatorio.pdf', {
    nextId,
  });
  log(`conteúdo externo acessado: ${content.id} (${content.contentType}) de ${content.sourceServer}`);

  // 3. ENHANCE: ativação do bookmarklet melhora o browser/cópia local.
  const activation = activate(bookmarklet);
  const enhanced = enhanceLocalCopy(content, activation.commands);
  log(`browser melhorado: tagging interface visível=${activation.taggingInterfaceVisible}`);

  // 5. ARMAZENAMENTO LOCAL do conteúdo sob label no cache da tagging interface.
  const auth = createAuth({ clock, nextId });
  const tagStore = createTagStore();
  const internalDb = createInternalDb({ nextId });
  const exporter = createExporter({ auth, tagStore, internalDb, clock });
  labelContent(enhanced.content, tagStore.contentCache);
  log(`conteúdo armazenado localmente sob label "${enhanced.content.label}"`);

  // 4. RECEPÇÃO DAS TAGS: usuário seleciona porções e cria 2 tags.
  const session = createTaggingSession(enhanced.content, { clock, nextId, user: 'analyst' });
  const tag1 = session.createTag(
    { tagOption: 'object', title: 'Suspeito identificado', type: 'Person' },
    { kind: 'text', startOffset: 0, endOffset: 18 },
  );
  exporter.receiveTag(tag1);
  const tag2 = session.createTag(
    { tagOption: 'link', title: 'Relacionado ao caso 42', type: 'CaseLink' },
    { kind: 'text', startOffset: 20, endOffset: 35 },
  );
  exporter.receiveTag(tag2);
  log(`tags criadas e armazenadas localmente: ${tag1.id}, ${tag2.id} (pendentes=${tagStore.pendingQueue().length})`);

  // 6. EXPORTAÇÃO: exige login; botão exporta a 1ª tag; flush exporta a fila.
  const login = auth.login('analyst', 'senha-demo');
  log(`login efetuado: sessão ${login.token} (user=${login.user})`);
  printReceipt(log, exporter.exportTag(login.token, tag1.id));
  for (const receipt of exporter.flushPending(login.token)) printReceipt(log, receipt);
  log(`demo concluído: pendentes=${tagStore.pendingQueue().length} registros=${internalDb.listRecords().length}`);
  return 0;
}

/** Ponto de entrada programático da CLI (testável, sem process.exit). */
export async function runCommandLine(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<CommandResult> {
  const log = deps.log ?? ((m: string): void => console.log(m));
  const error = deps.error ?? ((m: string): void => console.error(m));
  const args = argv.filter((a) => a !== '--');
  const [command, ...rest] = args;
  try {
    switch (command) {
      case 'demo':
        return { exitCode: runDemo(log) };
      case 'serve': {
        const port = portFromFlags(rest) ?? 8080;
        const started = await startServer(port);
        log(
          `external-content-exporter ouvindo em http://localhost:${started.port} ` +
            '(GET /health, POST /login, /bookmarklets, /sessions, /export)',
        );
        return { exitCode: 0 };
      }
      case undefined:
        log(USAGE);
        return { exitCode: 0 };
      default:
        error(USAGE);
        return { exitCode: 2 };
    }
  } catch (err) {
    error(`erro: ${err instanceof Error ? err.message : String(err)}`);
    return { exitCode: 2 };
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
  void runCommandLine(process.argv.slice(2)).then((result) => {
    process.exitCode = result.exitCode;
  });
}
