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
  it('createPostgresPlatformContext throws without authorize', () => {
    expect(() =>
      createPostgresPlatformContext({
        sql: { query: async () => ({ rows: [] }) },
        transaction: { transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }) },
        authorize: undefined as never,
      }),
    ).toThrow(/authorize/);
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
