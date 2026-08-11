/**
 * link-consistency-validator — parser da DSL própria do builder.
 *
 * Implementa funcionalmente o "builder escrito em uma domain-specific language"
 * do script de transformação descrito na patente US 8,930,897 B2 (sem copiar o
 * texto dos claims): a DSL permite DEFINIR entidades como OBJETO ou PROPRIEDADE
 * de objeto e CRIAR LINKS entre duas entidades, além de declarar CONDIÇÕES de
 * depuração que usam data items importados.
 *
 * Gramática (uma instrução por linha; comentários começam com '#'):
 *   object <Nome>
 *   property <Objeto>.<nome>: <tipo>
 *   link <De> --<predicado>--> <Para>
 *   condition <nome> <De> --<predicado>--> <Para> uses <dataItemId>
 */
import type { Condition, Entity, Link } from './types.js';

export class DslSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`linha ${line}: ${message}`);
    this.name = 'DslSyntaxError';
  }
}

export interface ParsedScript {
  entities: Entity[];
  links: Link[];
  conditions: Condition[];
}

const OBJECT_RE = /^object\s+([A-Za-z_][\w]*)$/;
const PROPERTY_RE = /^property\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)$/;
const LINK_RE = /^link\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)\s+--([A-Za-z_][\w]*)-->\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)$/;
const CONDITION_RE = /^condition\s+([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)\s+--([A-Za-z_][\w]*)-->\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)\s+uses\s+([^\s]+)$/;

/** Faz o parse do código-fonte DSL; lança DslSyntaxError com a linha do erro. */
export function parseDsl(source: string): ParsedScript {
  const script: ParsedScript = { entities: [], links: [], conditions: [] };
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? '';
    const text = raw.replace(/#.*$/, '').trim();
    if (text === '') continue;

    let m = OBJECT_RE.exec(text);
    if (m) {
      script.entities.push({ kind: 'object', name: m[1] as string });
      continue;
    }
    m = PROPERTY_RE.exec(text);
    if (m) {
      script.entities.push({
        kind: 'property',
        parent: m[1] as string,
        name: m[2] as string,
        dataType: m[3] as string,
      });
      continue;
    }
    m = LINK_RE.exec(text);
    if (m) {
      script.links.push({ from: m[1] as string, predicate: m[2] as string, to: m[3] as string });
      continue;
    }
    m = CONDITION_RE.exec(text);
    if (m) {
      script.conditions.push({
        name: m[1] as string,
        link: { from: m[2] as string, predicate: m[3] as string, to: m[4] as string },
        dataItemId: m[5] as string,
        line: lineNo,
      });
      continue;
    }
    throw new DslSyntaxError(`instrução DSL inválida: "${text}"`, lineNo);
  }
  return script;
}
