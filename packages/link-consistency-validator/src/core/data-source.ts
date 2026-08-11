/**
 * link-consistency-validator — fonte de dados e importação de data items.
 *
 * Implementa funcionalmente a "data source with data items" da patente
 * US 8,930,897 B2: importa data items de uma fonte de dados para transformação,
 * suportando CSV estruturado e texto não estruturado com extrator simples por
 * regex configurável. IDs são determinísticos (sem relógio/aleatoriedade).
 */
import type { DataItem } from './types.js';

export class DataSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/** Fonte CSV estruturada: primeira linha é o cabeçalho. */
export interface CsvDataSource {
  type: 'csv';
  content: string;
  delimiter?: string;
  /** Coluna usada como id do data item; padrão: índice da linha ("csv-1", ...). */
  idColumn?: string;
}

/** Fonte de texto não estruturado: extrator por regex configurável. */
export interface TextDataSource {
  type: 'text';
  content: string;
  /** Regex (uma ocorrência por data item); grupos de captura viram campos. */
  pattern: string;
  /** Nomes dos campos para grupos numerados (1..n); grupos nomeados têm prioridade. */
  fields?: string[];
  flags?: string;
}

export type DataSourceConfig = CsvDataSource | TextDataSource;

/** Divide uma linha CSV respeitando aspas duplas ("" escapa aspas). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (line.startsWith(delimiter, i)) {
      cells.push(current);
      current = '';
      i += delimiter.length - 1;
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function importCsv(config: CsvDataSource): DataItem[] {
  const delimiter = config.delimiter ?? ',';
  const lines = config.content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0] as string, delimiter).map((h) => h.trim());
  const items: DataItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i] as string, delimiter);
    const fields: Record<string, string> = {};
    header.forEach((name, j) => {
      fields[name] = (cells[j] ?? '').trim();
    });
    const id =
      config.idColumn !== undefined && fields[config.idColumn]
        ? (fields[config.idColumn] as string)
        : `csv-${i}`;
    items.push({ id, source: 'csv', fields });
  }
  return items;
}

function importText(config: TextDataSource): DataItem[] {
  let regex: RegExp;
  try {
    const flags = config.flags ?? 'gm';
    regex = new RegExp(config.pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch (err) {
    throw new DataSourceError(`regex de extração inválido: ${(err as Error).message}`);
  }
  const items: DataItem[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = regex.exec(config.content)) !== null) {
    index++;
    const fields: Record<string, string> = {};
    if (match.groups) {
      for (const [name, value] of Object.entries(match.groups)) {
        if (value !== undefined) fields[name] = value;
      }
    }
    for (let g = 1; g < match.length; g++) {
      const name = config.fields?.[g - 1];
      if (name !== undefined && fields[name] === undefined) {
        fields[name] = (match[g] ?? '') as string;
      }
    }
    items.push({ id: `text-${index}`, source: 'text', fields, text: match[0] });
    if (match[0] === '') regex.lastIndex++; // evita laço infinito em match vazio
  }
  return items;
}

/** Importa os data items da fonte de dados configurada. */
export function importDataItems(config: DataSourceConfig): DataItem[] {
  if (config.type === 'csv') return importCsv(config);
  if (config.type === 'text') return importText(config);
  throw new DataSourceError(`tipo de fonte de dados desconhecido: ${String((config as { type: unknown }).type)}`);
}
