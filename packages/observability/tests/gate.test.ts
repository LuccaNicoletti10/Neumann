/**
 * Gate TM0.5 — 100% das requisicoes HTTP devem emitir log com campos obrigatorios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertRequestCoverage,
  coverageReport,
  LogCapture,
} from '../src/harness.js';
import { REQUIRED_LOG_KEYS } from '../src/types.js';
import { startDemoServer } from '../src/demo-server.js';
import type { StartedDemoServer } from '../src/demo-server.js';

let server: StartedDemoServer;
let capture: LogCapture;
let base: string;

beforeAll(async () => {
  capture = new LogCapture();
  server = await startDemoServer(0, '127.0.0.1', {
    logDestination: capture.destination,
    identity: {
      service: 'observability-test',
      version: '0.1.0-test',
      deploymentId: 'gate-harness',
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

const scenarios: Array<{ label: string; path: string; init?: RequestInit; expectStatus?: number }> = [
  { label: 'health anonymous', path: '/health', expectStatus: 200 },
  {
    label: 'health with tenant',
    path: '/health',
    init: { headers: { 'X-Tenant-Id': 'tenant-a' } },
    expectStatus: 200,
  },
  {
    label: 'echo with principal',
    path: '/echo',
    init: { headers: { 'X-Principal-Id': 'alice', 'X-Tenant-Id': 't1' } },
    expectStatus: 200,
  },
  {
    label: 'echo denied',
    path: '/echo',
    expectStatus: 403,
  },
  {
    label: 'work ok',
    path: '/work',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Principal-Id': 'bob' },
      body: JSON.stringify({}),
    },
    expectStatus: 200,
  },
  {
    label: 'work error',
    path: '/work',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fail: true }),
    },
    expectStatus: 500,
  },
  {
    label: 'work denied',
    path: '/work',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deny: true }),
    },
    expectStatus: 403,
  },
  { label: 'not found', path: '/nope', expectStatus: 404 },
];

describe('gate TM0.5', () => {
  it('emits required fields for 20 mixed requests with 100% coverage', async () => {
    capture.clear();

    for (let i = 0; i < 20; i++) {
      const scenario = scenarios[i % scenarios.length]!;
      const res = await fetch(`${base}${scenario.path}`, scenario.init);
      if (scenario.expectStatus !== undefined) {
        expect(res.status).toBe(scenario.expectStatus);
      }
    }

    const logs = capture.requestLogs();
    expect(logs.length).toBe(20);

    const report = coverageReport(logs);
    expect(report.total).toBe(20);
    expect(report.complete).toBe(20);
    expect(report.incomplete).toBe(0);

    expect(() => assertRequestCoverage(logs)).not.toThrow();

    for (const key of REQUIRED_LOG_KEYS) {
      for (const log of logs) {
        expect(log[key]).toBeDefined();
        expect(String(log[key]).length).toBeGreaterThan(0);
      }
    }
  });

  it('includes principal when X-Principal-Id is set', async () => {
    capture.clear();
    await fetch(`${base}/echo`, {
      headers: { 'X-Principal-Id': 'charlie', 'X-Tenant-Id': 'tenant-z' },
    });

    const log = capture.requestLogs().at(-1);
    expect(log?.principal).toBe('user:charlie');
    expect(log?.tenant_id).toBe('tenant-z');
  });

  it('records duration_ms >= 0 and result ok/error/denied by status', async () => {
    capture.clear();

    await fetch(`${base}/health`);
    await fetch(`${base}/echo`);
    await fetch(`${base}/work`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fail: true }),
    });

    const logs = capture.requestLogs();
    expect(logs.length).toBe(3);

    for (const log of logs) {
      expect(log.duration_ms).toBeGreaterThanOrEqual(0);
    }

    expect(logs[0]?.result).toBe('ok');
    expect(logs[1]?.result).toBe('denied');
    expect(logs[2]?.result).toBe('error');
  });
});
