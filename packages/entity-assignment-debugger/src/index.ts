/**
 * entity-assignment-debugger — API pública.
 *
 * Pacote que implementa funcionalmente (de forma original) os mecanismos da
 * patente US 9,984,152 B2 ("Data Integration Tool"): ontologia que atribui
 * entidades como objeto/propriedade, builder que define entidades e cria links,
 * importação de data items estruturados/não estruturados, mapping data item →
 * parâmetros da ontologia e operação de depuração com indicação expressed/implicit.
 */

export * from './core/types.js';
export * from './core/builder.js';
export * from './core/ontology.js';
export * from './core/data-source.js';
export * from './core/debugger.js';
export { startServer, MAX_BODY, type StartedServer } from './server/index.js';
