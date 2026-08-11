/**
 * history-preserving-pipeline — src/core/blob-store.ts
 * Storage content-addressed (path = sha256/<hash>).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { contentRefFor, hashBytes } from './hash.js';
import type { DataContainer } from './types.js';

export interface BlobStore {
  put(bytes: Buffer | Uint8Array, mediaType?: string): DataContainer;
  get(contentHash: string): DataContainer | undefined;
  has(contentHash: string): boolean;
}

export class MemoryBlobStore implements BlobStore {
  private readonly byHash = new Map<string, DataContainer>();

  put(bytes: Buffer | Uint8Array, mediaType?: string): DataContainer {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const contentHash = hashBytes(buf);
    const existing = this.byHash.get(contentHash);
    if (existing) return existing;
    const container: DataContainer = {
      contentHash,
      contentRef: contentRefFor(contentHash),
      bytes: buf,
      mediaType,
    };
    this.byHash.set(contentHash, container);
    return container;
  }

  get(contentHash: string): DataContainer | undefined {
    return this.byHash.get(contentHash);
  }

  has(contentHash: string): boolean {
    return this.byHash.has(contentHash);
  }
}

/** Blob store em filesystem sob um diretório raiz (útil em testes). */
export class FsBlobStore implements BlobStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(this.rootDir, { recursive: true });
  }

  private pathFor(hash: string): string {
    return join(this.rootDir, 'sha256', hash.slice(0, 2), hash);
  }

  put(bytes: Buffer | Uint8Array, mediaType?: string): DataContainer {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const contentHash = hashBytes(buf);
    const path = this.pathFor(contentHash);
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buf);
      if (mediaType) {
        writeFileSync(`${path}.meta.json`, JSON.stringify({ mediaType }), 'utf8');
      }
    }
    return {
      contentHash,
      contentRef: contentRefFor(contentHash),
      bytes: buf,
      mediaType,
    };
  }

  get(contentHash: string): DataContainer | undefined {
    const path = this.pathFor(contentHash);
    if (!existsSync(path)) return undefined;
    const bytes = readFileSync(path);
    let mediaType: string | undefined;
    const metaPath = `${path}.meta.json`;
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { mediaType?: string };
        mediaType = meta.mediaType;
      } catch {
        /* ignore */
      }
    }
    return {
      contentHash,
      contentRef: contentRefFor(contentHash),
      bytes,
      mediaType,
    };
  }

  has(contentHash: string): boolean {
    return existsSync(this.pathFor(contentHash));
  }
}
