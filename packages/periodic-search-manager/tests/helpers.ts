/**
 * Utilitários de teste do periodic-search-manager.
 * Relógio fake injetável (determinismo) e helpers de diretório temporário.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Clock } from '../src/core/types.js';

/** Relógio fake: avanço controlado pelo teste. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(startIso = '2024-01-01T00:00:00.000Z') {
    this.current = new Date(startIso);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }
}

/** Cria um diretório temporário único para o teste. */
export async function makeTempDir(prefix = 'psm-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}