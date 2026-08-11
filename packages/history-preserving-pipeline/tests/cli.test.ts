/**
 * history-preserving-pipeline — tests/cli.test.ts
 * Demo determinístico: duas runs, mesma saída.
 */
import { describe, expect, it } from 'vitest';

import { runCommandLine, runDemo } from '../src/cli.js';

describe('CLI demo', () => {
  it('duas runs produzem a mesma saída', () => {
    const a: string[] = [];
    const b: string[] = [];
    expect(runDemo((m) => a.push(m))).toBe(0);
    expect(runDemo((m) => b.push(m))).toBe(0);
    expect(a.join('\n')).toBe(b.join('\n'));
    expect(a.some((l) => l.includes('duplicateCommit'))).toBe(true);
    expect(a.some((l) => l.includes('equalsV2=true'))).toBe(true);
  });

  it('help retorna 0', async () => {
    const lines: string[] = [];
    const code = await runCommandLine(['help'], { log: (m) => lines.push(m) });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/PASSO 8/);
  });
});
