/**
 * validation-result-notifier — src/index.ts
 *
 * Implementação funcional INDEPENDENTE (reimplementação original, sem copiar texto
 * dos claims) dos mecanismos da patente US 10.572.529 B2 (Palantir/Nassar,
 * "Data Integration Tool").
 *
 * Componente implementado: API pública do pacote — reexporta núcleo de validação
 * proativa, resultados implicit/expressed, renderers das 4 formas de indicação,
 * canais de entrega (debugger/email/popup) e o orquestrador ValidationNotifier.
 */

export * from './core/types.js';
export * from './core/validation.js';
export * from './core/results.js';
export * from './core/renderers.js';
export * from './core/channels.js';
export * from './core/notifier.js';
