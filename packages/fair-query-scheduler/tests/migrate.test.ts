/**
 * Mecanismo 6 (migração de nó): em t1 o job item é removido da fila enquanto
 * uma sub-task sua executa/executou no nó A; em t2 > t1 um SEGUNDO query job
 * (continuação) é gerado a partir do primeiro — retomando do último valor —
 * e sua próxima sub-task executa num nó B ≠ A. Resultados continuam corretos
 * (sem duplicar nem perder rows).
 */
import { describe, expect, it } from 'vitest';
import { FairScheduler } from '../src/core/scheduler.js';
import { FakeClock } from '../src/core/types.js';
import { genRows, twoNodeDbms } from './helpers.js';

describe('migração de nó', () => {
  it('continuação executa no nó B e resultados seguem corretos (sem duplicar/perder)', async () => {
    const scheduler = new FairScheduler({ dbms: twoNodeDbms(1000), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 1000 }); // nó padrão: node-a

    scheduler.step(); // sub-task 0 executa no nó A e o item volta à fila
    const job = scheduler.getJob(id)!;
    expect(job.taskLog[0]!.node).toBe('node-a');
    expect(job.rows).toHaveLength(100);
    expect(scheduler.queueSize).toBe(1);

    // t1: remover o item da fila; t2: gerar continuação atribuída ao nó B.
    expect(scheduler.migrate(id, 'node-b')).toBe(true);
    expect(job.node).toBe('node-b');
    expect(job.migrations).toBe(1);
    expect(scheduler.queueSize).toBe(1); // continuação enfileirada

    await scheduler.runUntilIdle();
    expect(job.state).toBe('done');

    // Sub-tasks após a migração executaram no nó B.
    expect(job.taskLog[0]!.node).toBe('node-a');
    for (const t of job.taskLog.slice(1)) {
      expect(t.node).toBe('node-b');
    }
    // A primeira sub-task no nó B retoma do último valor (id=100, sem after duplicado).
    expect(job.taskLog[1]!.after).toBe(100);

    // Sem duplicar nem perder: ids 1..1000 exatamente uma vez, em ordem.
    expect(job.rows.map((r) => r.id)).toEqual(genRows(1000).map((r) => r.id));
    const res = await scheduler.result(id);
    expect(res.rows).toHaveLength(1000);
  });

  it('migrar antes de qualquer execução simplesmente reatribui o nó', async () => {
    const scheduler = new FairScheduler({ dbms: twoNodeDbms(50), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 50 });
    expect(scheduler.migrate(id, 'node-b')).toBe(true);
    await scheduler.runUntilIdle();
    const job = scheduler.getJob(id)!;
    expect(job.taskLog[0]!.node).toBe('node-b');
    expect(job.rows).toHaveLength(50);
  });

  it('migrar para nó inexistente lança erro; job concluído retorna false', async () => {
    const scheduler = new FairScheduler({ dbms: twoNodeDbms(10), clock: new FakeClock(), thresholdCost: 100 });
    const id = scheduler.submit({ query: 't', costEstimate: 10 });
    expect(() => scheduler.migrate(id, 'node-z')).toThrow(/nó "node-z" não existe/);
    await scheduler.runUntilIdle();
    expect(scheduler.migrate(id, 'node-b')).toBe(false);
  });
});
