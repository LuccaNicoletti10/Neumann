/**
 * multi-row-transactions — src/core/timestamp.ts
 * Timestamps lógicos estritamente crescentes (sem Date.now no núcleo).
 */

import type { LogicalTimestamp } from 'contracts';

export interface TimestampService {
  /** Aloca e retorna próximo timestamp. */
  next(): LogicalTimestamp;
  /** Valor atual sem incrementar. */
  current(): LogicalTimestamp;
  /** Persiste highest (crash recovery). */
  persist?(): void;
  /** Highest já alocado (para testes de recover). */
  highestAllocated(): LogicalTimestamp;
}

export function createTimestampService(start: LogicalTimestamp = 0): TimestampService {
  let counter = start;
  let highest = start;

  return {
    next(): LogicalTimestamp {
      counter += 1;
      if (counter > highest) highest = counter;
      return counter;
    },
    current(): LogicalTimestamp {
      return counter;
    },
    highestAllocated(): LogicalTimestamp {
      return highest;
    },
  };
}

/** Recupera serviço a partir de highest persistido (crash recovery). */
export function recoverTimestampService(highestAllocated: LogicalTimestamp): TimestampService {
  return createTimestampService(highestAllocated);
}
