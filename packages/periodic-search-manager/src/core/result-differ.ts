/**
 * Diff/dedupe de resultados do periodic-search-manager.
 *
 * Componente da patente US 10,572,487 B1 (Palantir) implementado de forma
 * independente: "new-data detection" — além do watermark por timestamp,
 * mantemos por busca um seen-set de (recordId, hash sha256 do conteúdo).
 * Assim, um registro repetido NÃO é tratado como novo (sem alerta), enquanto
 * um registro com o MESMO id mas conteúdo ALTERADO (hash diferente) É tratado
 * como novo (gera alerta). O seen-set é persistido (result storage).
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DataRecord } from './data-source.js';
import { atomicWriteFile, readJsonFile } from './watermark-store.js';

/** Hash sha256 determinístico do conteúdo de um registro (chaves ordenadas). */
export function hashContent(content: Record<string, unknown>): string {
  const stable = stableStringify(content);
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

/** Serialização estável: ordena chaves recursivamente. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

/** Chave composta do seen-set. */
function seenKey(recordId: string, contentHash: string): string {
  return `${recordId}::${contentHash}`;
}

type SeenMap = Record<string, string[]>;

export interface DiffOutcome {
  /** Registros realmente novos (recordId+hash nunca vistos para esta busca). */
  newRecords: DataRecord[];
  /** Registros já vistos (deduplicados). */
  alreadySeenCount: number;
}

/**
 * ResultDiffer: separa registros realmente novos dos já vistos, por busca.
 * Persiste o seen-set em `seen.json` (atômico). Registros novos também são
 * anexados ao armazenamento de resultados (`results.jsonl`) pelo runner.
 */
export class ResultDiffer {
  private readonly file: string;
  private cache: SeenMap | undefined;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'seen.json');
  }

  /**
   * Calcula o diff para uma busca: retorna os registros novos (não marca como
   * vistos — chame `markSeen` após processar com sucesso).
   */
  async diff(searchId: string, records: DataRecord[]): Promise<DiffOutcome> {
    const seen = await this.seenSetFor(searchId);
    const newRecords: DataRecord[] = [];
    let alreadySeenCount = 0;
    for (const record of records) {
      const hash = hashContent(record.content);
      if (seen.has(seenKey(record.recordId, hash))) {
        alreadySeenCount += 1;
      } else {
        newRecords.push(record);
      }
    }
    return { newRecords, alreadySeenCount };
  }

  /** Marca registros como vistos para a busca e persiste o seen-set. */
  async markSeen(searchId: string, records: DataRecord[]): Promise<void> {
    if (records.length === 0) return;
    const map = await this.load();
    const set = new Set(map[searchId] ?? []);
    for (const record of records) {
      set.add(seenKey(record.recordId, hashContent(record.content)));
    }
    map[searchId] = [...set].sort();
    await atomicWriteFile(this.file, JSON.stringify(map, null, 2));
  }

  private async seenSetFor(searchId: string): Promise<Set<string>> {
    const map = await this.load();
    return new Set(map[searchId] ?? []);
  }

  private async load(): Promise<SeenMap> {
    this.cache ??= await readJsonFile<SeenMap>(this.file, {});
    return this.cache;
  }
}

/**
 * Anexa registros de resultado a um arquivo JSONL (result storage).
 * Cria o diretório se necessário.
 */
export async function appendJsonl(file: string, items: unknown[]): Promise<void> {
  if (items.length === 0) return;
  await mkdir(dirname(file), { recursive: true });
  const lines = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  await appendFile(file, lines, 'utf8');
}

/** Lê um arquivo JSONL; retorna lista vazia se inexistente. */
export async function readJsonl<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}