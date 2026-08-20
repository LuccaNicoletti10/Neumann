/**
 * platform-api — tests/production-authz.test.ts
 */
import { describe, expect, it } from 'vitest';

import { createActionExecutor } from 'action-engine';
import {
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';
import { ResourceIds, KERNEL_ONTOLOGY } from 'policy-engine';

import {
  createMemoryPlatformContext,
  createPostgresPlatformContext,
} from '../src/core/context.js';

describe('production fail-closed authorization', () => {
  it('createMemoryPlatformContext refuses implicit allow-all', () => {
    expect(() => createMemoryPlatformContext()).toThrow(/no implicit allow-all/);
  });

  it('named deny-all fixture denies reads and actions', () => {
    const ctx = createMemoryPlatformContext({ policyFixture: 'deny-all' });
    expect(
      ctx.policy.authorize({
        principal: 'anyone',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('deny');
    expect(ctx.policy).toBeTruthy();
  });

  it('createPostgresPlatformContext fails without sql or DATABASE_URL', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(createPostgresPlatformContext({} as never)).rejects.toThrow(/DATABASE_URL/);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });

  it('createActionExecutor production mode throws without authorize', () => {
    const objects = createMemoryObjectRepository();
    const links = createMemoryLinkRepository();
    expect(() =>
      createActionExecutor({
        objects,
        links,
        mode: 'production',
      } as never),
    ).toThrow(/authorize|durable/);
  });

  it('createActionExecutor memory mode throws without authorize', () => {
    const objects = createMemoryObjectRepository();
    const links = createMemoryLinkRepository();
    expect(() =>
      createActionExecutor({
        objects,
        links,
      } as never),
    ).toThrow(/authorize/);
  });
});
