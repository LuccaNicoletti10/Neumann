/**
 * platform-api — tests/ontology-evolution.test.ts
 * Memory runner for PROMPT 09 cases 11–19, 21, 22.
 */
import { describe, it } from 'vitest';

import { createMemoryPlatformContext } from '../src/core/context.js';
import { runOntologyEvolutionContract } from './ontology-evolution.js';

describe('ontology evolution — memory', () => {
  it('pins, migrates and rolls back without implicit schema change', async () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'allow-all', deterministic: false });
    await runOntologyEvolutionContract({ ctx });
  });
});
