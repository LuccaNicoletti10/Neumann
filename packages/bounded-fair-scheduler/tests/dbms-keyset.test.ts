// bounded-fair-scheduler — testes do DBMS simulado e do keyset chaining (mecanismos 2 e 3).
import { describe, expect, it } from 'vitest';
import { DatabaseManagementSystem, DatabaseNode } from '../src/core/dbms.js';
import { chooseTaskLimit } from '../src/core/task-splitter.js';
import { generateRows, ManualClock } from '../src/core/types.js';

describe('DatabaseNode — execução de sub-task {after, limit} com latência via Clock', () => {
  it('1ª sub-task (after=null) retorna as primeiras `limit` linhas e debita latência', () => {
    const node = new DatabaseNode('n1', generateRows(1000), 5, 1);
    const clock = new ManualClock(0);
    const rows = node.execute({ after: null, limit: 50 }, clock);
    expect(rows).toHaveLength(50);
    expect(rows[0]?.id).toBe(1);
    expect(rows[49]?.id).toBe(50);
    expect(clock.now()).toBe(5 + 1 * 50); // baseMs + perRowMs*rows
  });

  it('keyset chaining: after = id do último row da task anterior', () => {
    const node = new DatabaseNode('n1', generateRows(1000), 5, 1);
    const clock = new ManualClock(0);
    const t1 = node.execute({ after: null, limit: 50 }, clock);
    const lastId = t1[t1.length - 1]?.id;
    expect(lastId).toBe(50);
    const t2 = node.execute({ after: lastId ?? null, limit: 50 }, clock);
    expect(t2[0]?.id).toBe(51);
    expect(t2[t2.length - 1]?.id).toBe(100);
  });

  it('fim da cadeia: última página retorna < limit; depois, 0 linhas', () => {
    const node = new DatabaseNode('n1', generateRows(120), 5, 1);
    const clock = new ManualClock(0);
    const p1 = node.execute({ after: null, limit: 50 }, clock);
    const p2 = node.execute({ after: p1[p1.length - 1]?.id ?? null, limit: 50 }, clock);
    const p3 = node.execute({ after: p2[p2.length - 1]?.id ?? null, limit: 50 }, clock);
    expect(p3).toHaveLength(20); // 20 < 50 → esgotado
    const p4 = node.execute({ after: p3[p3.length - 1]?.id ?? null, limit: 50 }, clock);
    expect(p4).toHaveLength(0);
  });

  it('encadeamento completo cobre 1..N sem duplicatas', () => {
    const node = new DatabaseNode('n1', generateRows(1000), 5, 1);
    const clock = new ManualClock(0);
    const limit = chooseTaskLimit(1000, 50);
    const seen: number[] = [];
    let after: number | null = null;
    for (;;) {
      const rows = node.execute({ after, limit }, clock);
      seen.push(...rows.map((r) => r.id));
      after = rows[rows.length - 1]?.id ?? after;
      if (rows.length < limit) break;
    }
    expect(seen).toHaveLength(1000);
    expect(new Set(seen).size).toBe(1000);
    expect(seen).toEqual([...Array(1000)].map((_, i) => i + 1));
  });
});

describe('DatabaseManagementSystem — multi-nó', () => {
  it('uniform replica linhas em todos os nós; nó desconhecido falha', () => {
    const dbms = DatabaseManagementSystem.uniform(['node-A', 'node-B'], generateRows(10));
    expect(dbms.nodeNames()).toEqual(['node-A', 'node-B']);
    const clock = new ManualClock(0);
    expect(dbms.execute('node-B', { after: null, limit: 3 }, clock)).toHaveLength(3);
    expect(() => dbms.execute('node-Z', { after: null, limit: 1 }, clock)).toThrow();
  });
});