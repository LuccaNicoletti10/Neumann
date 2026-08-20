/**
 * platform-api — production config fail-closed (ADR-0021).
 */
import { describe, expect, it } from 'vitest';

import { assertProductionConfig, assertPostgresContextForProduction } from '../src/core/assert-production-config.js';
import type { PlatformContext } from '../src/core/context.js';

describe('assertProductionConfig', () => {
  it('is a no-op outside production', () => {
    expect(() =>
      assertProductionConfig({
        mode: 'memory',
        env: 'test',
        ready: false,
        policyDegraded: true,
        policyFixture: 'allow-all',
      }),
    ).not.toThrow();
  });

  it('refuses memory, allow-all, missing URL, degraded policy, and local registry', () => {
    expect(() =>
      assertProductionConfig({
        mode: 'memory',
        env: 'production',
        ready: true,
        policyDegraded: false,
        databaseUrl: 'postgres://x',
      }),
    ).toThrow(/memory/);

    expect(() =>
      assertProductionConfig({
        mode: 'postgres',
        env: 'production',
        ready: true,
        policyDegraded: false,
        policyFixture: 'allow-all',
        databaseUrl: 'postgres://x',
      }),
    ).toThrow(/allow-all/);

    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() =>
        assertProductionConfig({
          mode: 'postgres',
          env: 'production',
          ready: true,
          policyDegraded: false,
        }),
      ).toThrow(/DATABASE_URL/);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }

    expect(() =>
      assertProductionConfig({
        mode: 'postgres',
        env: 'production',
        ready: false,
        policyDegraded: false,
        databaseUrl: 'postgres://x',
      }),
    ).toThrow(/not ready/);

    expect(() =>
      assertProductionConfig({
        mode: 'postgres',
        env: 'production',
        ready: true,
        policyDegraded: true,
        databaseUrl: 'postgres://x',
      }),
    ).toThrow(/degraded/);

    expect(() =>
      assertProductionConfig({
        mode: 'postgres',
        env: 'production',
        ready: true,
        policyDegraded: false,
        databaseUrl: 'postgres://x',
        hasProcessLocalFunctionRegistry: true,
      }),
    ).toThrow(/Function registry/);
  });

  it('assertPostgresContextForProduction refuses memory mode', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const ctx = {
        mode: 'memory',
        ready: true,
        policy: { degraded: () => false },
      } as unknown as PlatformContext;
      expect(() => assertPostgresContextForProduction(ctx)).toThrow(/memory/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
