/**
 * external-content-exporter — src/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: API PÚBLICA DO PACOTE —
 * reexporta o núcleo (tipos, determinismo, bookmarklet, conteúdo, tagging,
 * armazenamento local, auth, exportação e banco interno), o servidor HTTP e a
 * linha de comando. Nenhum texto dos claims é reproduzido; apenas a
 * funcionalidade é reimplementada de forma original.
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/bookmarklet.js';
export * from './core/content.js';
export * from './core/tagging.js';
export * from './core/tagStore.js';
export * from './core/auth.js';
export * from './core/exporter.js';
export * from './core/internalDb.js';
export { createServer, createAppState, startServer, MAX_BODY } from './server/index.js';
export type { AppState, ServerDeps, StartedServer } from './server/index.js';
