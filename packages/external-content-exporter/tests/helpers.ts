/**
 * external-content-exporter — tests/helpers.ts
 * Fixtures compartilhadas dos testes (stack determinística e conteúdo externo).
 */

import { createAuth } from '../src/core/auth.js';
import type { AuthService } from '../src/core/auth.js';
import { accessExternalContent, createWebBrowser, enhanceLocalCopy } from '../src/core/content.js';
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createExporter } from '../src/core/exporter.js';
import type { Exporter } from '../src/core/exporter.js';
import { createInternalDb } from '../src/core/internalDb.js';
import type { InternalDatabase } from '../src/core/internalDb.js';
import { createTaggingSession } from '../src/core/tagging.js';
import type { TaggingSession } from '../src/core/tagging.js';
import { createTagStore } from '../src/core/tagStore.js';
import type { TagStore } from '../src/core/tagStore.js';
import type { Clock, ExternalContent, IdGenerator, Tag } from '../src/core/types.js';

/** Stack completa com clock e gerador de ids compartilhados (determinística). */
export interface TestStack {
  clock: Clock;
  nextId: IdGenerator;
  auth: AuthService;
  tagStore: TagStore;
  internalDb: InternalDatabase;
  exporter: Exporter;
}

export function makeStack(options: { autoExportOnCreate?: boolean } = {}): TestStack {
  const clock = createDeterministicClock();
  const nextId = createIdGenerator();
  const auth = createAuth({ clock, nextId });
  const tagStore = createTagStore();
  const internalDb = createInternalDb({ nextId });
  const exporter = createExporter({
    auth,
    tagStore,
    internalDb,
    clock,
    autoExportOnCreate: options.autoExportOnCreate,
  });
  return { clock, nextId, auth, tagStore, internalDb, exporter };
}

/** Acessa um conteúdo externo de exemplo e devolve a cópia melhorada. */
export function sampleContent(nextId: IdGenerator): ExternalContent {
  const browser = createWebBrowser();
  const content = accessExternalContent(browser, 'https://externo.example.com/relatorio.pdf', {
    nextId,
  });
  return enhanceLocalCopy(content, ['exibirTaggingInterface()']).content;
}

/** Sessão de tagging de exemplo sobre o conteúdo de exemplo. */
export function sampleSession(stack: TestStack): { session: TaggingSession; content: ExternalContent } {
  const content = sampleContent(stack.nextId);
  stack.tagStore.contentCache.storeContent(content.label, content);
  const session = createTaggingSession(content, {
    clock: stack.clock,
    nextId: stack.nextId,
    user: 'analyst',
  });
  return { session, content };
}

/** Cria uma tag de exemplo na sessão e a armazena localmente. */
export function makeTag(stack: TestStack, session: TaggingSession, title = 'Título da tag'): Tag {
  const tag = session.createTag(
    { tagOption: 'object', title, type: 'Person' },
    { kind: 'text', startOffset: 0, endOffset: 10 },
  );
  stack.exporter.receiveTag(tag);
  return tag;
}

/** Helper HTTP para os testes de servidor. */
export async function postJson(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}
