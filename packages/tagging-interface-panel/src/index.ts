/**
 * tagging-interface-panel — src/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: API PÚBLICA
 * DO PACOTE — reexporta o núcleo (ontologia, parser, fusion, campos, opções,
 * tagged objects, busca, pares, painel), o servidor HTTP e o runner da CLI.
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

export * from './core/types.js';
export * from './core/ontology.js';
export * from './core/parser.js';
export * from './core/fusion.js';
export * from './core/fields.js';
export * from './core/options.js';
export * from './core/taggedObjects.js';
export * from './core/search.js';
export * from './core/pairs.js';
export * from './core/panel.js';
export {
  createServer,
  startServer,
  createDefaultPanel,
  MAX_BODY,
} from './server/index.js';
export type { ServerDeps, StartedServer } from './server/index.js';
export { runCommandLine } from './cli.js';
export type { CliDeps } from './cli.js';
