// bounded-fair-scheduler — testes de migração de nó (mecanismo 8).
import { describe, expect, it } from 'vitest';
import { BoundedFairScheduler } from '../src/core/scheduler.js';
import { ManualClock } from '../src/core/types.js';
import { makeDistinctNodesDbms, ids, makeScheduler } from './helpers.js';

describe('migração de nó A → B', () => {
  it('remove o item do nó A, gera 2º job baseado no 1º e executa sua 1ª sub-task no nó B ≠ A', () => {
    const dbms = makeDistinctNodesDbms(100, ['node-A', 'node-B']);
    const scheduler = new BoundedFairScheduler({
      maxQueueSize: 4,
      maxTaskSize: 50,
      clock: new ManualClock(0),
      dbms,
      defaultNode: 'node-A',
    });
    const { jobId } = scheduler.submit({ query: 'SELECT * FROM t', costEstimate: 100 });
    scheduler.step(); // 1ª sub-task no nó A: rows 1..50 (value prefixo "node-A")
    const src = scheduler.getRecord(jobId);
    expect(src?.node).toBe('node-A');
    expect(src?.rows).toHaveLength(50);
    expect(src?.rows.every((r) => r.value.startsWith('node-A'))).toBe(true);
    expect(src?.lastValue).toBe(50);

    const mig = scheduler.migrate(jobId, 'node-B');
    expect(mig).not.toBeNull();
    expect(mig?.fromNode).toBe('node-A');
    expect(mig?.toNode).toBe('node-B');
    expect(mig?.newJobId).not.toBe(jobId);
    expect(mig?.admitted).toBe('execution');

    // Job original sai da fila e fica marcado como migrado.
    expect(scheduler.getRecord(jobId)?.status).toBe('migrated');
    expect(scheduler.getRecord(jobId)?.migratedTo).toBe('node-B');
    expect(scheduler.queueSnapshot().execution.map((e) => e.jobId)).toEqual([
      mig?.newJobId ?? '',
    ]);

    // O 2º job carrega o progresso e sua 1ª sub-task executa no nó B.
    scheduler.step();
    const derived = scheduler.getRecord(mig?.newJobId ?? '');
    expect(derived?.node).toBe('node-B');
    expect(derived?.migratedFrom).toBe(jobId);
    const newRows = derived?.rows.slice(50) ?? [];
    expect(newRows).toHaveLength(50); // rows 51..100
    expect(newRows.every((r) => r.value.startsWith('node-B'))).toBe(true); // prova: veio do nó B
    expect(ids(newRows)).toEqual([...Array(50)].map((_, i) => i + 51));
  });

  it('sem perda nem duplicata de rows: união A + B = 1..N ordenada', () => {
    const dbms = makeDistinctNodesDbms(100, ['node-A', 'node-B']);
    const scheduler = new BoundedFairScheduler({
      maxQueueSize: 4,
      maxTaskSize: 50,
      clock: new ManualClock(0),
      dbms,
      defaultNode: 'node-A',
    });
    const { jobId } = scheduler.submit({ query: 'q', costEstimate: 100 });
    scheduler.step();
    const mig = scheduler.migrate(jobId, 'node-B');
    scheduler.runUntilIdle();
    const derived = scheduler.getRecord(mig?.newJobId ?? '');
    expect(derived?.status).toBe('completed');
    expect(derived?.rows).toHaveLength(100);
    const got = ids(derived?.rows ?? []);
    expect(new Set(got).size).toBe(100); // sem duplicatas
    expect(got).toEqual([...Array(100)].map((_, i) => i + 1)); // sem perda, ordenado
  });

  it('migração respeita backpressure: sem vaga, o 2º job vai para a waiting queue', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 1, rowCount: 100 });
    const a = scheduler.submit({ query: 'a', costEstimate: 100 });
    const b = scheduler.submit({ query: 'b', costEstimate: 100 }); // waiting
    const mig = scheduler.migrate(a.jobId, 'node-B');
    // Remover `a` liberou slot → b foi promovido; o 2º job chega com fila cheia.
    expect(mig?.admitted).toBe('waiting');
    expect(scheduler.queueSnapshot().execution.map((e) => e.jobId)).toEqual([b.jobId]);
    expect(scheduler.queueSnapshot().waiting.map((e) => e.jobId)).toEqual([
      mig?.newJobId ?? '',
    ]);
    scheduler.runUntilIdle();
    expect(scheduler.getRecord(mig?.newJobId ?? '')?.status).toBe('completed');
  });

  it('falhas: job inexistente → null; nó igual → erro; nó desconhecido → erro', () => {
    const { scheduler } = makeScheduler({ maxQueueSize: 2 });
    const { jobId } = scheduler.submit({ query: 'q', costEstimate: 10, node: 'node-A' });
    expect(scheduler.migrate('nope', 'node-B')).toBeNull();
    expect(() => scheduler.migrate(jobId, 'node-A')).toThrow();
    expect(() => scheduler.migrate(jobId, 'node-Z')).toThrow();
  });
});