/**
 * history-preserving-pipeline — tests/helpers.ts
 */
import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createHistoryPreservingPipeline } from '../src/core/system.js';
import type { HistoryPreservingPipeline } from '../src/core/system.js';

export function createTestPipeline(): HistoryPreservingPipeline {
  return createHistoryPreservingPipeline({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
  });
}
