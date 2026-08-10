#!/usr/bin/env node
/**
 * observability — src/cli.ts
 *
 * CLI do pacote observability: servidor demo com instrumentacao TM0.5 e
 * comando `check` que valida cobertura de 100% dos campos obrigatorios.
 *
 * Uso:
 *   observability serve --port <n> [--host <h>] [--otlp-url <url>]
 *   observability check [--port <n>] [--requests <n>]
 */

import { assertRequestCoverage, coverageReport, LogCapture } from './harness.js';
import { DEFAULT_DEMO_IDENTITY, startDemoServer } from './demo-server.js';

interface ParsedArgs {
  command: string;
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, 'true');
    }
  }
  return {
    command: positional[0] ?? 'help',
    flags,
  };
}

function flagInt(flags: Map<string, string>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function runServe(flags: Map<string, string>): Promise<void> {
  const port = flagInt(flags, 'port', 3000);
  const host = flags.get('host') ?? '0.0.0.0';
  const otlpUrl = flags.get('otlp-url');

  const server = await startDemoServer(port, host, {
    identity: DEFAULT_DEMO_IDENTITY,
    ...(otlpUrl ? { otlpUrl } : {}),
  });

  console.log(
    `observability demo listening on http://${host}:${server.port} (${DEFAULT_DEMO_IDENTITY.service}@${DEFAULT_DEMO_IDENTITY.version})`,
  );

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

async function runCheck(flags: Map<string, string>): Promise<void> {
  const port = flagInt(flags, 'port', 0);
  const requestCount = flagInt(flags, 'requests', 20);
  const capture = new LogCapture();

  const server = await startDemoServer(port, '127.0.0.1', {
    identity: DEFAULT_DEMO_IDENTITY,
    logDestination: capture.destination,
  });

  const base = `http://127.0.0.1:${server.port}`;
  const scenarios: Array<{ path: string; init?: RequestInit }> = [
    { path: '/health' },
    { path: '/health', init: { headers: { 'X-Tenant-Id': 'tenant-a' } } },
    { path: '/echo', init: { headers: { 'X-Principal-Id': 'user-1' } } },
    { path: '/echo', init: { headers: { 'X-Principal-Id': 'user-2', 'X-Tenant-Id': 'tenant-b' } } },
    { path: '/echo' },
    { path: '/work', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } },
    {
      path: '/work',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Principal-Id': 'svc-1' },
        body: JSON.stringify({ fail: true }),
      },
    },
    {
      path: '/work',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deny: true }),
      },
    },
    { path: '/missing-route' },
  ];

  for (let i = 0; i < requestCount; i++) {
    const scenario = scenarios[i % scenarios.length]!;
    await fetch(`${base}${scenario.path}`, scenario.init);
  }

  const logs = capture.requestLogs();
  const report = coverageReport(logs);
  assertRequestCoverage(logs);

  console.log(
    JSON.stringify(
      {
        gate: 'TM0.5',
        identity: DEFAULT_DEMO_IDENTITY,
        coverage: report,
        pass: true,
      },
      null,
      2,
    ),
  );

  await server.close();
}

function printHelp(): void {
  console.log(`observability — pino + OpenTelemetry (gate TM0.5)

Commands:
  serve   Start demo Fastify server
          --port <n>       Port (default 3000)
          --host <h>       Host (default 0.0.0.0)
          --otlp-url <url> Optional OTLP trace exporter URL

  check   Boot server, fire mixed requests, assert 100% log coverage
          --port <n>       Port (default ephemeral)
          --requests <n>   Number of requests (default 20)
`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'serve':
      await runServe(flags);
      return;
    case 'check':
      await runCheck(flags);
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
