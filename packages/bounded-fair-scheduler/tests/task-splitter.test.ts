// bounded-fair-scheduler — testes do divisor de sub-tarefas (mecanismos 1 e 2 da patente).
import { describe, expect, it } from 'vitest';
import { chooseTaskLimit, isChainExhausted, nextSubTask } from '../src/core/task-splitter.js';

describe('chooseTaskLimit — invariante: limit < costEstimate (sempre que costEstimate > 1)', () => {
  it('costEstimate=1000, maxTaskSize=50 → tasks de 50', () => {
    expect(chooseTaskLimit(1000, 50)).toBe(50);
  });

  it('costEstimate=1 → task única de 1', () => {
    expect(chooseTaskLimit(1, 50)).toBe(1);
  });

  it('costEstimate=2 → limit 1 (< 2)', () => {
    expect(chooseTaskLimit(2, 50)).toBe(1);
  });

  it('costEstimate pequeno limita por costEstimate-1 (cost=10 → 9)', () => {
    expect(chooseTaskLimit(10, 50)).toBe(9);
    expect(chooseTaskLimit(10, 50)).toBeLessThan(10);
  });

  it('invariante exaustivo: para todo costEstimate>1, limit < costEstimate', () => {
    for (const cost of [2, 3, 7, 50, 51, 100, 999, 1000, 1_000_000]) {
      for (const max of [1, 2, 10, 50, 5000]) {
        const limit = chooseTaskLimit(cost, max);
        expect(limit).toBeGreaterThanOrEqual(1);
        expect(limit).toBeLessThan(cost);
        expect(limit).toBeLessThanOrEqual(max);
      }
    }
  });

  it('rejeita entradas inválidas', () => {
    expect(() => chooseTaskLimit(0, 50)).toThrow();
    expect(() => chooseTaskLimit(1.5, 50)).toThrow();
    expect(() => chooseTaskLimit(100, 0)).toThrow();
  });
});

describe('nextSubTask — geração lazy com keyset chaining', () => {
  it('1ª sub-task tem after=null (sem seek) e rate limiter aplicado', () => {
    const task = nextSubTask(
      { jobId: 'j1', node: 'node-A', subTaskSeqCompleted: 0, lastValue: null, rowsCollected: 0 },
      1000,
      50,
    );
    expect(task).toEqual({ jobId: 'j1', seq: 1, after: null, limit: 50, node: 'node-A' });
  });

  it('sub-task seguinte INCLUI o valor do último resultado (after = lastValue)', () => {
    const task = nextSubTask(
      { jobId: 'j1', node: 'node-A', subTaskSeqCompleted: 3, lastValue: 150, rowsCollected: 150 },
      1000,
      50,
    );
    expect(task.seq).toBe(4);
    expect(task.after).toBe(150);
  });

  it('última sub-task nunca excede o que falta para a estimativa (mantendo limit < costEstimate)', () => {
    const task = nextSubTask(
      { jobId: 'j1', node: 'node-A', subTaskSeqCompleted: 1, lastValue: 9, rowsCollected: 9 },
      10,
      50,
    );
    expect(task.limit).toBe(1); // falta 1 para a estimativa de 10
    expect(task.limit).toBeLessThan(10);
    const exhausted = nextSubTask(
      { jobId: 'j1', node: 'node-A', subTaskSeqCompleted: 2, lastValue: 10, rowsCollected: 10 },
      10,
      50,
    );
    expect(exhausted.limit).toBeGreaterThanOrEqual(1);
    expect(exhausted.limit).toBeLessThan(10);
  });

  it('isChainExhausted: fim quando retorna < limit', () => {
    expect(isChainExhausted(49, 50)).toBe(true);
    expect(isChainExhausted(0, 50)).toBe(true);
    expect(isChainExhausted(50, 50)).toBe(false);
  });
});