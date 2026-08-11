/**
 * entity-assignment-debugger — fontes de dados (data sources).
 *
 * Implementa funcionalmente o componente da patente US 9,984,152 B2 relativo à
 * IMPORTAÇÃO DE DATA ITEMS a partir de data sources ESTRUTURADAS (CSV, JSON) e
 * NÃO ESTRUTURADAS (texto livre, com extrator baseado em padrões/regex). Cada
 * fonte produz DataItems cujos campos poderão ser mapeados para parâmetros da
 * ontologia pelo transformation script.
 */

import type { DataItem } from './types.js';

/** Interface comum de fonte de dados: importa data items de forma determinística. */
export interface DataSource {
  readonly kind: string;
  importData(): DataItem[];
}

/** Descritor serializável de uma fonte (usado pelo servidor HTTP e pela CLI). */
export interface DataSourceDescriptor {
  type: 'csv' | 'json' | 'text';
  content: string;
  delimiter?: string;
  /** Regex (string) com grupos nomeados, obrigatório para type 'text'. */
  pattern?: string;
}

/** Data source ESTRUTURADA em CSV (primeira linha = cabeçalho). */
export class CsvDataSource implements DataSource {
  readonly kind = 'csv';

  constructor(
    private readonly csv: string,
    private readonly delimiter: string = ',',
  ) {}

  importData(): DataItem[] {
    const lines = this.csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const header = lines[0];
    if (!header) return [];
    const columns = header.split(this.delimiter).map((c) => c.trim());
    const items: DataItem[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = (lines[i] as string).split(this.delimiter);
      const fields: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        fields[col] = (cells[idx] ?? '').trim();
      });
      items.push({ id: `row-${i}`, fields });
    }
    return items;
  }
}

/** Data source ESTRUTURADA em JSON (array de objetos). */
export class JsonDataSource implements DataSource {
  readonly kind = 'json';

  constructor(private readonly json: string | unknown[]) {}

  importData(): DataItem[] {
    const parsed: unknown = typeof this.json === 'string' ? JSON.parse(this.json) : this.json;
    if (!Array.isArray(parsed)) {
      throw new Error('JSON data source: esperado um array de objetos');
    }
    return parsed.map((entry, idx) => {
      const fields =
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
          ? { ...(entry as Record<string, unknown>) }
          : { value: entry };
      return { id: `item-${idx + 1}`, fields };
    });
  }
}

/**
 * Data source NÃO ESTRUTURADA: texto livre do qual um extrator por padrões
 * (regex com grupos nomeados) extrai data items, uma correspondência por linha.
 */
export class TextDataSource implements DataSource {
  readonly kind = 'text';
  private readonly regex: RegExp;

  constructor(
    private readonly text: string,
    pattern: RegExp | string,
  ) {
    const source = typeof pattern === 'string' ? pattern : pattern.source;
    this.regex = new RegExp(source);
  }

  importData(): DataItem[] {
    const items: DataItem[] = [];
    const lines = this.text.split(/\r?\n/);
    let n = 0;
    for (const line of lines) {
      const match = this.regex.exec(line);
      if (match && match.groups) {
        n += 1;
        items.push({ id: `match-${n}`, fields: { ...match.groups } });
      }
    }
    return items;
  }
}

/** Constrói uma DataSource a partir de um descritor serializável. */
export function dataSourceFromDescriptor(desc: DataSourceDescriptor): DataSource {
  switch (desc.type) {
    case 'csv':
      return new CsvDataSource(desc.content, desc.delimiter ?? ',');
    case 'json':
      return new JsonDataSource(desc.content);
    case 'text':
      if (!desc.pattern) {
        throw new Error('data source "text" requer "pattern" (regex com grupos nomeados)');
      }
      return new TextDataSource(desc.content, desc.pattern);
    default:
      throw new Error(`tipo de data source desconhecido: ${String((desc as DataSourceDescriptor).type)}`);
  }
}
