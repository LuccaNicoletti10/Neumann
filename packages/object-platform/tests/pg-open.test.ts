/**
 * object-platform — PostgreSQL open-path classification (no live server).
 */
import { describe, expect, it } from 'vitest';

import {
  classifyPgConnectError,
  openIsolatedPg,
  PostgresConfigError,
  PostgresUnavailableError,
  redactDatabaseUrl,
  tryOpenIsolatedPg,
} from '../src/core/pg-sql.js';

describe('redactDatabaseUrl', () => {
  it('strips the password', () => {
    expect(redactDatabaseUrl('postgres://neumann:secret@127.0.0.1:55432/neumann')).toBe(
      'postgres://neumann:***@127.0.0.1:55432/neumann',
    );
  });
});

describe('classifyPgConnectError', () => {
  const url = 'postgres://neumann:***@127.0.0.1:55432/neumann';

  it('does not treat authentication failure as unavailable', () => {
    const err = classifyPgConnectError(
      Object.assign(new Error('password authentication failed for user "neumann"'), {
        code: '28P01',
      }),
      url,
    );
    expect(err).toBeInstanceOf(PostgresConfigError);
    expect(err).not.toBeInstanceOf(PostgresUnavailableError);
    expect(err.message).toMatch(/authentication failed/);
    expect(err.message).not.toMatch(/secret|password=/);
  });

  it('does not treat a missing database as unavailable', () => {
    const err = classifyPgConnectError(
      Object.assign(new Error('database "wrong" does not exist'), { code: '3D000' }),
      url,
    );
    expect(err).toBeInstanceOf(PostgresConfigError);
  });

  it('classifies connection refused as unavailable', () => {
    const err = classifyPgConnectError(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }),
      url,
    );
    expect(err).toBeInstanceOf(PostgresUnavailableError);
  });
});

describe('openIsolatedPg / tryOpenIsolatedPg', () => {
  it('openIsolatedPg throws when DATABASE_URL is missing', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(openIsolatedPg()).rejects.toMatchObject({ code: 'DATABASE_URL_MISSING' });
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });

  it('tryOpenIsolatedPg returns undefined when DATABASE_URL is missing', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(tryOpenIsolatedPg()).resolves.toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });

  it('openIsolatedPg throws on an invalid port; tryOpenIsolatedPg does not skip-as-success', async () => {
    const url = 'postgres://neumann:neumann@127.0.0.1:1/neumann';
    await expect(openIsolatedPg(url)).rejects.toBeInstanceOf(PostgresUnavailableError);
    await expect(tryOpenIsolatedPg(url)).resolves.toBeUndefined();
  });
});
