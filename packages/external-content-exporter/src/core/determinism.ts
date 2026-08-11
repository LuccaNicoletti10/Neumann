/**
 * external-content-exporter — src/core/determinism.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: DETERMINISMO TOTAL — clock
 * injetável (DateAdded vem do clock, nunca de Date.now()) e gerador de ids
 * injetável com contadores por prefixo (defaults "tag-1", "content-1").
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

import type { Clock, IdGenerator } from './types.js';

/** Instante inicial do clock determinístico default. */
export const DEFAULT_EPOCH = '2024-01-01T00:00:00.000Z';

/**
 * Clock determinístico default: parte de DEFAULT_EPOCH (ou de `start`) e
 * avança um segundo a cada chamada. Nunca consulta o relógio do sistema.
 */
export function createDeterministicClock(start: string = DEFAULT_EPOCH): Clock {
  const base = Date.parse(start);
  if (!Number.isFinite(base)) {
    throw new Error(`instante inicial inválido: ${start}`);
  }
  let tick = 0;
  return (): string => {
    const instant = new Date(base + tick * 1000);
    tick += 1;
    return instant.toISOString();
  };
}

/**
 * Gerador de ids determinístico default: mantém um contador por prefixo, de
 * modo que o primeiro id de tags é "tag-1" e o primeiro de conteúdos é
 * "content-1", independentemente da ordem de criação entre tipos.
 */
export function createIdGenerator(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix: string): string => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}
