import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/types.js';
import { InMemoryJobQueue } from '../src/jobs/queue.js';

describe('InMemoryJobQueue', () => {
  it('retries with exponential backoff using FakeClock', async () => {
    const clock = new FakeClock();
    const queue = new InMemoryJobQueue({ clock, baseBackoffMs: 100 });
    const jobId = queue.enqueue({
      name: 'retry-me',
      payload: { x: 1 },
      maxAttempts: 3,
    });

    let attempts = 0;
    const fail = async () => {
      attempts += 1;
      throw new Error('fail');
    };

    await queue.tick(fail);
    expect(queue.get(jobId)?.status).toBe('pending');
    expect(queue.get(jobId)?.attempts).toBe(1);

    clock.advance(50);
    expect(queue.dequeue()).toBeNull();

    clock.advance(60);
    await queue.tick(fail);
    expect(queue.get(jobId)?.attempts).toBe(2);

    clock.advance(200);
    await queue.tick(async () => {});
    expect(queue.get(jobId)?.status).toBe('completed');
    expect(attempts).toBe(2);
  });

  it('crash before complete leaves job pending and completes on restart', async () => {
    const queue = new InMemoryJobQueue();
    const jobId = queue.enqueue({ name: 'survive-crash', payload: { ok: true } });

    const job = queue.dequeue();
    expect(job?.id).toBe(jobId);
    expect(job?.status).toBe('processing');

    expect(queue.recover()).toBe(1);
    expect(queue.get(jobId)?.status).toBe('pending');

    await queue.runWorker(async () => {});
    expect(queue.get(jobId)?.status).toBe('completed');
  });

  it('dequeues fairly across fairKey buckets at same priority', () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({ name: 'a', payload: {}, priority: 1, fairKey: 'tenant-a' });
    queue.enqueue({ name: 'b', payload: {}, priority: 1, fairKey: 'tenant-b' });
    queue.enqueue({ name: 'c', payload: {}, priority: 1, fairKey: 'tenant-a' });

    const first = queue.dequeue();
    const second = queue.dequeue();
    expect(first?.fairKey).not.toBe(second?.fairKey);
  });

  it('prefers higher priority jobs', () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({ name: 'low', payload: {}, priority: 0 });
    queue.enqueue({ name: 'high', payload: {}, priority: 10 });

    const job = queue.dequeue();
    expect(job?.name).toBe('high');
  });
});
