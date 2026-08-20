/**
 * Dedicated LISTEN helpers (ADR-0009). Fakes only — no live PostgreSQL.
 */
import { describe, expect, it } from 'vitest';

import {
  attachPoolListen,
  listenForNotifications,
  POLICY_GENERATION_CHANNEL,
  quoteIdent,
  type NotificationClient,
  type PoolLike,
} from '../src/core/pg-sql.js';

function fakeClient(opts?: {
  failListen?: boolean;
  onRelease?: () => void;
}): NotificationClient & { queries: string[]; handlers: Array<(msg: { channel: string; payload?: string }) => void> } {
  const handlers: Array<(msg: { channel: string; payload?: string }) => void> = [];
  const queries: string[] = [];
  return {
    queries,
    handlers,
    async query(text: string) {
      queries.push(text);
      if (opts?.failListen && text.startsWith('LISTEN')) {
        throw new Error('listen fail');
      }
      return { rows: [] };
    },
    on(event, handler) {
      if (event === 'notification') handlers.push(handler);
    },
    off(event, handler) {
      if (event !== 'notification') return;
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    },
    release() {
      opts?.onRelease?.();
    },
  };
}

describe('listenForNotifications', () => {
  it('subscribes, filters by channel, and UNLISTEN on stop', async () => {
    const client = fakeClient();
    const payloads: string[] = [];
    const stop = await listenForNotifications(client, POLICY_GENERATION_CHANNEL, (p) =>
      payloads.push(p),
    );
    expect(client.queries[0]).toBe(`LISTEN ${quoteIdent(POLICY_GENERATION_CHANNEL)}`);
    client.handlers[0]!({ channel: 'other', payload: '9' });
    client.handlers[0]!({ channel: POLICY_GENERATION_CHANNEL, payload: '12' });
    client.handlers[0]!({ channel: POLICY_GENERATION_CHANNEL });
    expect(payloads).toEqual(['12', '']);
    await stop();
    expect(client.handlers).toHaveLength(0);
    expect(client.queries.some((q) => q.startsWith('UNLISTEN'))).toBe(true);
  });

  it('refuses a channel that is not a SQL identifier', async () => {
    await expect(
      listenForNotifications(fakeClient(), 'bad-channel!', () => undefined),
    ).rejects.toThrow(/invalid SQL identifier/);
  });
});

describe('attachPoolListen', () => {
  it('holds one checkout with search_path until stop', async () => {
    let released = 0;
    const client = fakeClient({ onRelease: () => {
      released += 1;
    } });
    const pool: PoolLike = {
      async connect() {
        return client;
      },
    };
    const seen: string[] = [];
    const stop = await attachPoolListen(pool, {
      schema: 'iso_test',
      channel: POLICY_GENERATION_CHANNEL,
      onNotify: (p) => seen.push(p),
    });
    expect(client.queries[0]).toBe(`SET search_path TO ${quoteIdent('iso_test')}`);
    client.handlers[0]!({ channel: POLICY_GENERATION_CHANNEL, payload: '3' });
    expect(seen).toEqual(['3']);
    await stop();
    await stop();
    expect(released).toBe(1);
  });

  it('releases the checkout when LISTEN fails', async () => {
    let released = 0;
    const client = fakeClient({
      failListen: true,
      onRelease: () => {
        released += 1;
      },
    });
    const pool: PoolLike = {
      async connect() {
        return client;
      },
    };
    await expect(
      attachPoolListen(pool, {
        channel: POLICY_GENERATION_CHANNEL,
        onNotify: () => undefined,
      }),
    ).rejects.toThrow(/listen fail/);
    expect(released).toBe(1);
  });
});
