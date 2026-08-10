/**
 * Mecanismo 2 (decisão por threshold): costEstimate <= threshold → task única;
 * costEstimate > threshold → múltiplas sub-query tasks.
 */
import { describe, expect, it } from 'vitest';
import { FairScheduler } from '../src/core/scheduler.js';
import { shouldSplit, taskLimit } from '../src/core/task-splitter.js';
import { FakeClock } from '../src/core/types.js';
import { singleNodeDbms } from './helpers.js';

describe('decisão por threshold', () => {
  it('shouldSplit/taskLimit: abaixo ou igual não divide; acima divide com LIMIT ≈ threshold', () => {
    expect(shouldSplit(100, 100)).toBe(false);
    expect(shouldSplit(99, 100)).toBe(false);
    expect(shouldSplit(101, 100)).toBe(true);
    expect(taskLimit(100, 100)).toBe(Number.MAX_SAFE_INTEGER);
    expect(taskLimit(101, 100)).toBe(100);
  });

  it('costEstimate <= threshold → exatamente 1 task', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(50), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 50 });
    await scheduler.runUntilIdle();
    const job = scheduler.getJob(id)!;
    expect(job.state).toBe('done');
    expect(job.split).toBe(false);
    expect(job.tasksExecuted).toBe(1);
    expect(job.rows).toHaveLength(50);
  });

  it('costEstimate > threshold → múltiplas tasks', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(1000), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 1000 });
    await scheduler.runUntilIdle();
    const job = scheduler.getJob(id)!;
    expect(job.split).toBe(true);
    expect(job.tasksExecuted).toBeGreaterThan(1);
    expect(job.rows).toHaveLength(1000);
  });
});
