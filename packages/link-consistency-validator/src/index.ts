/**
 * link-consistency-validator — API pública do pacote.
 *
 * Reexporta os mecanismos reimplementados (de forma independente) da patente
 * US 8,930,897 B2: DSL do builder, builder do script de transformação,
 * parâmetros de ontologia, fonte de dados e operação de depuração.
 */
export * from './core/types.js';
export * from './core/dsl.js';
export * from './core/builder.js';
export * from './core/ontology.js';
export * from './core/data-source.js';
export * from './core/validator.js';
export { runCli, type CliIO } from './cli.js';
