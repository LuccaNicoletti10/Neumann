/**
 * logger — redaction e child bindings por request.
 */
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import type { DestinationStream } from 'pino';
import { childForRequest, createRootLogger } from '../src/logger.js';

function captureLogger(): { logger: ReturnType<typeof createRootLogger>; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const logger = createRootLogger(
    { service: 'test-svc', version: '9.9.9', deploymentId: 'dep-1' },
    { level: 'info' },
    stream as unknown as DestinationStream,
  );

  return { logger, lines };
}

describe('createRootLogger', () => {
  it('binds service identity on every log line', () => {
    const { logger, lines } = captureLogger();
    logger.info({ msg: 'boot' });

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed['service']).toBe('test-svc');
    expect(parsed['version']).toBe('9.9.9');
    expect(parsed['deployment_id']).toBe('dep-1');
  });

  it('redacts sensitive fields', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      msg: 'login',
      password: 'secret-password',
      token: 'secret-token',
      authorization: 'Bearer abc',
      API_KEY: 'super-secret',
    });

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed['password']).toBe('[REDACTED]');
    expect(parsed['token']).toBe('[REDACTED]');
    expect(parsed['authorization']).toBe('[REDACTED]');
    expect(parsed['API_KEY']).toBe('[REDACTED]');
  });
});

describe('childForRequest', () => {
  it('adds per-request bindings without losing service identity', () => {
    const { logger, lines } = captureLogger();
    const child = childForRequest(logger, {
      trace_id: 'abc123',
      principal: 'user:alice',
      tenant_id: 'tenant-1',
      operation: 'GET /health',
    });
    child.info({ msg: 'request.completed', duration_ms: 12, result: 'ok' });

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed['trace_id']).toBe('abc123');
    expect(parsed['principal']).toBe('user:alice');
    expect(parsed['tenant_id']).toBe('tenant-1');
    expect(parsed['operation']).toBe('GET /health');
    expect(parsed['service']).toBe('test-svc');
  });
});
