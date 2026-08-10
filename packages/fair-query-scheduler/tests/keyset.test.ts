/**
 * Mecanismo 3 (keyset/seek pagination): 1ª task tem LIMIT = threshold e sem
 * `after`; após executar, a próxima task inclui after = id do último row
 * retornado; encadeia até esgotar (última task retorna < limit).
 */
import { describe, expect, it } from 'vitest';
import { FairScheduler } from '../src/core/scheduler.js';
import { SubQueryTaskIterator } from '../src/core/task-splitter.js';
import { FakeClock } from '../src/core/types.js';
import { genRows, singleNodeDbms } from './helpers.js';

describe('divisão por keyset/seek pagination', () => {
  it('iterador: 1ª task sem after e com limit; após execução, after = último id; fim quando retorna < limit', () => {
    const it = new SubQueryTaskIterator('job-x', 100);
    const t0 = it.peek()!;
    expect(t0).toMatchObject({ jobId: 'job-x', seq: 0, limit: 100 });
    expect(t0.after).toBeUndefined();

    // Execução completa (== limit): próxima task inclui o último valor retornado.
    it.advance(genRows(100));
    const t1 = it.peek()!;
    expect(t1.seq).toBe(1);
    expect(t1.after).toBe(100);
    expect(it.done).toBe(false);

    // Execução parcial (< limit): fim da carga detectado.
    it.advance(genRows(40).map((r) => ({ id: r.id + 100, value: r.value })));
    expect(it.done).toBe(true);
    expect(it.peek()).toBeNull();
  });

  it('scheduler: encadeia after → id do último row até esgotar', async () => {
    const scheduler = new FairScheduler({ dbms: singleNodeDbms(250), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 250 });
    await scheduler.runUntilIdle();
    const job = scheduler.getJob(id)!;

    expect(job.tasksExecuted).toBe(3); // 100 + 100 + 50
    expect(job.taskLog[0]!.after).toBeUndefined();
    expect(job.taskLog[0]!.limit).toBe(100);
    expect(job.taskLog[1]!.after).toBe(100); // último id da task 0
    expect(job.taskLog[2]!.after).toBe(200); // último id da task 1
    expect(job.taskLog[2]!.rowsReturned).toBe(50); // < limit → esgotou
    expect(job.rows.map((r) => r.id)).toEqual(genRows(250).map((r) => r.id));
  });
});
