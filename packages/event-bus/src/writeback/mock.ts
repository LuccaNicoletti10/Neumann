/**
 * event-bus — MockWritebackConnector (tests / chaos).
 */

import type { WritebackConnector, WritebackRequest, WritebackResult } from './types.js';

export interface CreateMockWritebackConnectorOptions {
  execute: (req: WritebackRequest) => Promise<WritebackResult> | WritebackResult;
}

export function createMockWritebackConnector(
  opts: CreateMockWritebackConnectorOptions,
): WritebackConnector {
  return {
    kind: 'mock',
    async execute(req) {
      return await opts.execute(req);
    },
  };
}
