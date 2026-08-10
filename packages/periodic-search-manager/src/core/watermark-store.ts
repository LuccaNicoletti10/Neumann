/**
 * Armazenamento de high-watermarks do periodic-search-manager.
 *
 * Componente da patente US 10,572,487 B1 (Palantir) implementado de forma
 * independente: "new-data detection" — para cada par (busca, fonte de dados)
 * mantemos o timestamp do último registro já visto (high-watermark). Cada
 * execução periódica consulta a fonte apenas por dados POSTERIORES a esse
 * watermark, garantindo que o sistema "busque apenas dados novos" sem
 * reprocessar o que já foi buscado antes.
 *
 * Persistido em JSON com escrita atômica (tmp + rename).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Grava `data` em `file` de forma atômica (arquivo temporário + rename). */
export async function atomicWriteFile(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

/** Lê um arquivo JSON; retorna `fallback` se não existir ou estiver inválido. */
export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Chave composta (searchId, sourceId). */
function watermarkKey(searchId: string, sourceId: string): string {
  return `${searchId}::${sourceId}`;
}

type WatermarkMap = Record<string, string>;

/**
 * Store de watermarks por (searchId, sourceId). Carrega sob demanda do disco
 * e persiste a cada atualização (durabilidade entre reinícios).
 */
export class WatermarkStore {
  private readonly file: string;
  private cache: WatermarkMap | undefined;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'watermarks.json');
  }

  /** Retorna o watermark atual do par (search, fonte), ou undefined se nunca rodou. */
  async get(searchId: string, sourceId: string): Promise<string | undefined> {
    const map = await this.load();
    return map[watermarkKey(searchId, sourceId)];
  }

  /** Atualiza o watermark do par (search, fonte) para `timestamp` e persiste. */
  async set(searchId: string, sourceId: string, timestamp: string): Promise<void> {
    const map = await this.load();
    map[watermarkKey(searchId, sourceId)] = timestamp;
    await atomicWriteFile(this.file, JSON.stringify(map, null, 2));
  }

  /** Snapshot de todos os watermarks (chave `searchId::sourceId`). */
  async all(): Promise<WatermarkMap> {
    const map = await this.load();
    return { ...map };
  }

  private async load(): Promise<WatermarkMap> {
    this.cache ??= await readJsonFile<WatermarkMap>(this.file, {});
    return this.cache;
  }
}