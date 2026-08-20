/**
 * ingestion-runtime — catalog contract on memory.
 */
import { describe, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from 'object-platform';

import {
  createMemoryConnectorRegistrationRepository,
  createMemoryMappingVersionRepository,
} from '../src/index.js';
import { runCatalogContract } from './catalog-contract.js';

describe('catalog contract (memory)', () => {
  it('connectors and mappings share one authority', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    await runCatalogContract({
      connectors: createMemoryConnectorRegistrationRepository(),
      mappings: createMemoryMappingVersionRepository({ clock, nextId }),
      now: clock(),
    });
  });
});
