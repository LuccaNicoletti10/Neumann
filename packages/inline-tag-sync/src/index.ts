/**
 * inline-tag-sync — src/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,552,524 B1 (Palantir, "In-Line Document Tagging and Object-Based Data
 * Synchronization"). Este arquivo implementa funcionalmente o componente:
 * API PÚBLICA DO PACOTE — reexporta o núcleo (tipos, documento, object store,
 * in-line tagging, data object, sincronização e renderização), o servidor HTTP
 * das plataformas e a CLI programática. Nenhum texto dos claims é reproduzido;
 * apenas a funcionalidade é reimplementada de forma original.
 */

export * from './core/types.js';
export * from './core/document.js';
export * from './core/objectStore.js';
export * from './core/tagging.js';
export * from './core/dataObject.js';
export * from './core/sync.js';
export * from './core/render.js';
export { createServer, startServer, MAX_BODY } from './server/index.js';
export type { ServerDeps, StartedServer } from './server/index.js';
export { runCommandLine } from './cli.js';
export type { CliDeps } from './cli.js';
