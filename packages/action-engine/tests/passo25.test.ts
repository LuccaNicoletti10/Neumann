/**
 * action-engine — tests/passo25.test.ts
 * Gate: observe → decide → act → write-back → novo estado no audit.
 */

import { describe, expect, it } from 'vitest';

import { runWritebackDemo } from '../src/cli.js';

describe('Passo 25 — write-back', () => {
  it('cli writeback: ciclo fecha no audit', async () => {
    const lines: string[] = [];
    const code = await runWritebackDemo((m) => lines.push(m));
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
