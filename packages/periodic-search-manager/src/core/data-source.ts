/**
 * Fontes de dados do periodic-search-manager.
 *
 * Componente da patente US 10,572,487 B1 (Palantir) implementado de forma
 * independente: "multiple data sources" — uma busca periódica pode abranger
 * várias fontes; cada execução consulta cada fonte com um parâmetro `since`
 * (high-watermark) para obter apenas dados ainda não buscados ("new-data
 * detection"). Aqui definimos a interface DataSource, duas implementações
 * concretas (memória e arquivos JSONL) e um registro de fontes.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { QuerySpec } from './types.js';

/** Registro de dado retornado por uma fonte. */
export interface DataRecord {
  recordId: string;
  sourceId: string;
  /** Timestamp ISO 8601 do registro; usado para o watermark. */
  timestamp: string;
  content: Record<string, unknown>;
}

/**
 * Interface de uma fonte de dados consultável.
 * `query(q, since)` deve retornar apenas registros com timestamp > since,
 * quando `since` é informado.
 */
export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  query(q: QuerySpec, since?: string): Promise<DataRecord[]>;
}

/** Compara timestamps ISO de forma segura (strings ISO 8601 comparam lexicograficamente). */
function isAfterTimestamp(timestamp: string, since: string): boolean {
  return timestamp > since;
}

/** Aplica o QuerySpec (texto + filtros + limite) a uma lista de registros. */
function applyQuerySpec(records: DataRecord[], q: QuerySpec): DataRecord[] {
  let out = records;
  if (q.text !== undefined && q.text.trim() !== '') {
    const needle = q.text.trim().toLowerCase();
    out = out.filter((r) => {
      const haystack = Object.values(r.content)
        .filter((v): v is string | number | boolean =>
          typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
        )
        .map((v) => String(v).toLowerCase())
        .join(' ');
      return haystack.includes(needle);
    });
  }
  if (q.filters !== undefined) {
    out = out.filter((r) =>
      Object.entries(q.filters ?? {}).every(([key, expected]) => r.content[key] === expected),
    );
  }
  if (q.limit !== undefined && q.limit >= 0) {
    out = out.slice(0, q.limit);
  }
  return out;
}

/**
 * Fonte de dados em memória: dados injetados no construtor; `append()` simula
 * a chegada de novos dados entre execuções periódicas.
 */
export class InMemoryDataSource implements DataSource {
  readonly kind = 'memory';
  private records: DataRecord[] = [];

  constructor(
    readonly id: string,
    readonly name: string,
    initialRecords: DataRecord[] = [],
  ) {
    this.records = [...initialRecords];
  }

  /** Injeta novos registros (simula novos dados chegando na fonte). */
  append(records: DataRecord[]): void {
    this.records.push(...records);
  }

  query(q: QuerySpec, since?: string): Promise<DataRecord[]> {
    let out = [...this.records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (since !== undefined) {
      out = out.filter((r) => isAfterTimestamp(r.timestamp, since));
    }
    out = applyQuerySpec(out, q);
    return Promise.resolve(out);
  }

  /** Snapshot dos registros (utilitário para testes/CLI). */
  list(): DataRecord[] {
    return [...this.records];
  }
}

/**
 * Fonte de dados baseada em arquivos JSONL (um registro por linha) em um
 * diretório. Cada linha deve ser um DataRecord serializado (sourceId é
 * sobrescrito com o id da fonte se ausente).
 */
export class JsonFileDataSource implements DataSource {
  readonly kind = 'jsonl';

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly dir: string,
  ) {}

  async query(q: QuerySpec, since?: string): Promise<DataRecord[]> {
    const files = await this.listJsonlFiles();
    const records: DataRecord[] = [];
    for (const file of files) {
      const raw = await readFile(join(this.dir, file), 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        const parsed = JSON.parse(trimmed) as DataRecord;
        records.push({ ...parsed, sourceId: parsed.sourceId ?? this.id });
      }
    }
    records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let out = records;
    if (since !== undefined) {
      out = out.filter((r) => isAfterTimestamp(r.timestamp, since));
    }
    return applyQuerySpec(out, q);
  }

  private async listJsonlFiles(): Promise<string[]> {
    const entries = await readdir(this.dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && (e.name.endsWith('.jsonl') || e.name.endsWith('.json')))
      .map((e) => e.name)
      .sort();
  }
}

/** Erro lançado quando uma fonte não é encontrada no registro. */
export class DataSourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Data source não encontrada: ${id}`);
    this.name = 'DataSourceNotFoundError';
  }
}

/**
 * Registro (registry) de fontes de dados disponíveis para as buscas
 * periódicas. Suporta múltiplas fontes ("multiple data sources").
 */
export class DataSourceRegistry {
  private readonly sources = new Map<string, DataSource>();

  register(source: DataSource): void {
    this.sources.set(source.id, source);
  }

  unregister(id: string): boolean {
    return this.sources.delete(id);
  }

  get(id: string): DataSource {
    const source = this.sources.get(id);
    if (source === undefined) {
      throw new DataSourceNotFoundError(id);
    }
    return source;
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  list(): DataSource[] {
    return [...this.sources.values()];
  }
}