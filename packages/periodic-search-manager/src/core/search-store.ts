/**
 * Persistência de buscas/resultados/alertas/runs do periodic-search-manager.
 *
 * Componente da patente US 10,572,487 B1 (Palantir) implementado de forma
 * independente: "result storage" — as configurações de busca (searches.json),
 * os resultados (results.jsonl), os alertas (alerts.jsonl) e os registros de
 * execução (runs.jsonl) ficam armazenados em disco, com escrita atômica
 * (arquivo temporário + rename) para os arquivos JSON.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunRecord, SearchConfig, SearchResultRecord } from './types.js';
import { appendJsonl, readJsonl } from './result-differ.js';
import { atomicWriteFile, readJsonFile } from './watermark-store.js';

/** Erro lançado quando uma busca não existe. */
export class SearchNotFoundError extends Error {
  constructor(id: string) {
    super(`Busca não encontrada: ${id}`);
    this.name = 'SearchNotFoundError';
  }
}

type SearchMap = Record<string, SearchConfig>;

/**
 * Store de SearchConfig (CRUD persistido em searches.json, escrita atômica)
 * + acesso aos arquivos JSONL de resultados e runs.
 */
export class SearchStore {
  private readonly searchesFile: string;
  private readonly resultsFile: string;
  private readonly runsFile: string;
  private cache: SearchMap | undefined;

  constructor(private readonly dataDir: string) {
    this.searchesFile = join(dataDir, 'searches.json');
    this.resultsFile = join(dataDir, 'results.jsonl');
    this.runsFile = join(dataDir, 'runs.jsonl');
  }

  async create(search: Omit<SearchConfig, 'id'> & { id?: string }): Promise<SearchConfig> {
    const map = await this.load();
    const id = search.id ?? randomUUID();
    if (map[id] !== undefined) {
      throw new Error(`Busca já existe: ${id}`);
    }
    const full: SearchConfig = { ...search, id };
    map[id] = full;
    await this.persist(map);
    return full;
  }

  async update(id: string, patch: Partial<Omit<SearchConfig, 'id'>>): Promise<SearchConfig> {
    const map = await this.load();
    const existing = map[id];
    if (existing === undefined) {
      throw new SearchNotFoundError(id);
    }
    const updated: SearchConfig = { ...existing, ...patch, id };
    map[id] = updated;
    await this.persist(map);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const map = await this.load();
    if (map[id] === undefined) {
      return false;
    }
    delete map[id];
    await this.persist(map);
    return true;
  }

  async get(id: string): Promise<SearchConfig> {
    const map = await this.load();
    const search = map[id];
    if (search === undefined) {
      throw new SearchNotFoundError(id);
    }
    return search;
  }

  async list(): Promise<SearchConfig[]> {
    const map = await this.load();
    return Object.values(map).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Persiste resultados de uma execução (anexa ao results.jsonl). */
  async appendResults(records: SearchResultRecord[]): Promise<void> {
    await appendJsonl(this.resultsFile, records);
  }

  /** Persiste o registro de uma execução (anexa ao runs.jsonl). */
  async appendRun(run: RunRecord): Promise<void> {
    await appendJsonl(this.runsFile, [run]);
  }

  /** Lista resultados armazenados, opcionalmente por busca. */
  async listResults(searchId?: string): Promise<SearchResultRecord[]> {
    const all = await readJsonl<SearchResultRecord>(this.resultsFile);
    return searchId === undefined ? all : all.filter((r) => r.searchId === searchId);
  }

  /** Lista execuções, opcionalmente por busca. */
  async listRuns(searchId?: string): Promise<RunRecord[]> {
    const all = await readJsonl<RunRecord>(this.runsFile);
    return searchId === undefined ? all : all.filter((r) => r.searchId === searchId);
  }

  /** Lê o arquivo searches.json bruto (debug/CLI). */
  async rawSearches(): Promise<SearchMap> {
    return readJsonFile<SearchMap>(this.searchesFile, {});
  }

  private async load(): Promise<SearchMap> {
    await mkdir(this.dataDir, { recursive: true });
    this.cache ??= await readJsonFile<SearchMap>(this.searchesFile, {});
    return this.cache;
  }

  private async persist(map: SearchMap): Promise<void> {
    await atomicWriteFile(this.searchesFile, JSON.stringify(map, null, 2));
  }
}

/** Utilitário: lê um arquivo inteiro como string (usado pelo CLI). */
export async function readTextFile(file: string): Promise<string> {
  return readFile(file, 'utf8');
}