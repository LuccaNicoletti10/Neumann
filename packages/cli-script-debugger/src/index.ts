/**
 * cli-script-debugger — src/index.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 11,100,154 B2 (Palantir/Nassar, "Data Integration Tool"). Este arquivo
 * implementa funcionalmente o componente: API PÚBLICA DO PACOTE — reexporta o
 * núcleo de validação (builder, ontologia, config, validator, indicação), o
 * runner de linha de comando e o servidor HTTP da debugger application.
 */

export * from './core/types.js';
export * from './core/builder.js';
export * from './core/ontology.js';
export * from './core/config.js';
export * from './core/validator.js';
export * from './core/indication.js';
export * from './core/runner.js';
export {
  createServer,
  startServer,
  MAX_BODY,
} from './server/index.js';
export type {
  InlineDebugRequest,
  ServerDeps,
  StartedServer,
} from './server/index.js';
