/**
 * platform-api — tests/production-authz.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createActionExecutor } from 'action-engine';
import {
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';

import { createPostgresPlatformContext } from '../src/core/context.js';

describe('production fail-closed authorization', () => {
  const stubSql = { query: async () => ({ rows: [] }) };
  const stubTx = {
    transaction: async <T>(fn: (sql: typeof stubSql) => Promise<T> | T) => fn(stubSql),
  };

  it('createPostgresPlatformContext throws without authorizer', () => {
    expect(() =>
      createPostgresPlatformContext({
        sql: stubSql,
        transaction: stubTx,
        authorizer: undefined as never,
      }),
    ).toThrow(/authorizer/);
  });

  it('createPostgresPlatformContext ignores authorize-only and still requires authorizer', () => {
    expect(() =>
      createPostgresPlatformContext({
        sql: stubSql,
        transaction: stubTx,
        authorize: () => ({
          decision: 'allow',
          principalEpids: [],
          resourceEpid: null,
          reason: 'nope',
        }),
        authorizer: undefined as never,
      }),
    ).toThrow(/authorizer/);
  });

  it('createActionExecutor production mode throws without authorize', () => {
    const objects = createMemoryObjectRepository();
    const links = createMemoryLinkRepository();
    expect(() =>
      createActionExecutor({
        objects,
        links,
        mode: 'production',
      }),
    ).toThrow(/fail-closed/);
  });
});
