/**
 * tagging-interface-panel — src/core/parser.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da
 * publicação US 2014/0282121 A1 (Palantir, "Tagging Interface for External
 * Content"). Este arquivo implementa funcionalmente o componente: PARSER DE
 * PROPRIEDADES COMPOSTAS — compila parser definitions com tokens entre chaves
 * (regex symbology, ex.: "{LAST NAME}, {FIRST NAME}") em expressões regulares
 * e decompõe a entrada nos componentes da propriedade (Name:Last, Name:First).
 * "Smith, Jane" é válido para esse padrão; "Smith Jane" é inválido para ele,
 * embora outra parser definition possa aceitá-lo. Nenhum texto dos claims é
 * reproduzido; apenas a funcionalidade é reimplementada de forma original.
 */

import type { ParserDefinition } from './types.js';

/** Parser definition compilada: regex + tokens na ordem do padrão. */
export interface CompiledParser {
  definition: ParserDefinition;
  regex: RegExp;
  tokens: string[];
}

/** Resultado do parse de uma entrada. */
export interface ParseResult {
  valid: boolean;
  /** Valores por token do padrão (ex.: { 'LAST NAME': 'Smith' }). */
  components?: Record<string, string>;
  /** Valores por property type (ex.: { 'Name:Last': 'Smith' }). */
  mapped?: Record<string, string>;
}

/** Escapa caracteres especiais de regex em trechos literais do padrão. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TOKEN_PATTERN = /\{([^{}]+)\}/g;

/**
 * Compila uma parser definition: tokens "{TOKEN}" viram grupos de captura
 * não gulosos e os trechos literais são escapados. A regex é ancorada
 * (^...$), portanto a entrada precisa casar com o padrão inteiro.
 */
export function compileParserDefinition(definition: ParserDefinition): CompiledParser {
  const tokens: string[] = [];
  let source = '';
  let lastIndex = 0;
  for (const match of definition.pattern.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    source += escapeRegex(definition.pattern.slice(lastIndex, index));
    source += '(.+?)';
    tokens.push(match[1] ?? '');
    lastIndex = index + match[0].length;
  }
  source += escapeRegex(definition.pattern.slice(lastIndex));

  // Todo token do padrão precisa estar associado a um property type.
  for (const token of tokens) {
    if (!definition.components.some((c) => c.token === token)) {
      throw new Error(`token sem componente associado: {${token}}`);
    }
  }
  return { definition, regex: new RegExp(`^${source}$`), tokens };
}

/**
 * Faz o parse da entrada segundo uma parser definition compilada.
 * Retorna { valid: false } quando a entrada não casa com o padrão.
 */
export function parseInput(parser: CompiledParser, input: string): ParseResult {
  const match = parser.regex.exec(input);
  if (match === null) return { valid: false };
  const components: Record<string, string> = {};
  const mapped: Record<string, string> = {};
  parser.tokens.forEach((token, i) => {
    const value = match[i + 1] ?? '';
    components[token] = value;
    const component = parser.definition.components.find((c) => c.token === token);
    if (component !== undefined) {
      mapped[component.propertyType] = value;
    }
  });
  return { valid: true, components, mapped };
}

/** Par definition + resultado para entradas aceitas por múltiplas definições. */
export interface DefinitionMatch {
  definitionName: string;
  mapped: Record<string, string>;
}

/**
 * Tenta o parse da entrada com VÁRIAS parser definitions: uma entrada
 * inválida para uma definição pode ser válida para outra (ex.: "Smith Jane"
 * falha em "{LAST NAME}, {FIRST NAME}" mas casa em "{FIRST NAME} {LAST NAME}").
 * Retorna apenas as definições que aceitaram a entrada, em ordem.
 */
export function parseWithDefinitions(
  definitions: readonly ParserDefinition[],
  input: string,
): DefinitionMatch[] {
  const matches: DefinitionMatch[] = [];
  for (const definition of definitions) {
    const result = parseInput(compileParserDefinition(definition), input);
    if (result.valid && result.mapped !== undefined) {
      matches.push({ definitionName: definition.name, mapped: result.mapped });
    }
  }
  return matches;
}
