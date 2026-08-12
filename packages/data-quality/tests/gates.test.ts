/**
 * data-quality — tests/gates.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createDataQualityEngine } from '../src/core/engine.js';
import { runDemo } from '../src/cli.js';

function eng() {
  return createDataQualityEngine({
    clock: createDeterministicClock(),
    nextId: createIdGenerator(),
    now: '2024-06-01T12:00:00.000Z',
  });
}

describe('Passo 13 gates', () => {
  it('pós-run: violação → quarentena com motivo', () => {
    const e = eng();
    e.registerDataset({
      id: 't',
      name: 't',
      version: 1,
      columns: ['id', 'v'],
      updatedAt: '2024-06-01T11:00:00.000Z',
      rows: [
        { id: 1, v: 'a' },
        { id: null, v: 'b' },
      ],
    });
    e.addRule({
      id: 'r1',
      name: 'id required',
      condition: { kind: 'not_null', column: 'id' },
      severity: 'quarantine',
      action: { kind: 'quarantine' },
      scope: 't',
      version: 1,
      owner: 'qa',
      active: true,
    });

    const result = e.run('t');
    expect(result.report.scores).toHaveLength(6);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]?.reason).toContain('id');
    expect(result.cleanRows).toHaveLength(1);
    expect(e.listQuarantine('t')[0]?.reason.length).toBeGreaterThan(0);
  });

  it('composite join multi-input', () => {
    const e = eng();
    e.registerDataset({
      id: 'a',
      name: 'a',
      version: 1,
      columns: ['k', 'x'],
      updatedAt: '2024-06-01T11:00:00.000Z',
      rows: [
        { k: 1, x: 'p' },
        { k: 2, x: 'q' },
      ],
    });
    e.registerDataset({
      id: 'b',
      name: 'b',
      version: 1,
      columns: ['k', 'y'],
      updatedAt: '2024-06-01T11:00:00.000Z',
      rows: [{ k: 1, y: 'z' }],
    });
    const c = e.defineComposite({
      id: 'ab',
      name: 'ab',
      sourceDatasetIds: ['a', 'b'],
      joinKeys: [
        {
          leftDatasetId: 'a',
          leftColumn: 'k',
          rightDatasetId: 'b',
          rightColumn: 'k',
        },
      ],
    });
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]?.['b.y']).toBe('z');
  });

  it('cli demo exit 0', () => {
    const lines: string[] = [];
    expect(runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
