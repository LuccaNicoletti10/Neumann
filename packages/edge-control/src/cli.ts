#!/usr/bin/env node
/**
 * edge-control — src/cli.ts
 * demo: subscribe → CanonicalEvent + baseline/anomalia/transmissão.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertCanonicalEvent } from 'contracts';
import type { EdgeOperator } from 'contracts';
import { assertConnectorShape } from 'connector-sdk';

import { createMemoryEdgeConnector } from './core/connector.js';
import { createEdgeControlServer } from './core/server.js';

const USAGE = `edge-control (edge) — PASSO 32: fonte remota/edge + supervisory control
  US 11,799,877 / US 12,261,861 / US20250233873A1

Uso:
  edge demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export async function runDemo(log: (message: string) => void = console.log): Promise<number> {
  const mark: EdgeOperator = {
    id: 'op-mark',
    displayName: 'Mark',
    typicalLocation: 'nyc',
    workHoursStart: 9,
    workHoursEnd: 17,
  };
  const john: EdgeOperator = {
    id: 'op-john',
    displayName: 'John',
    typicalLocation: 'nyc',
    workHoursStart: 9,
    workHoursEnd: 17,
  };

  const edge = createMemoryEdgeConnector({ connectorId: 'edge-1', sourceSystem: 'edge' });
  assertConnectorShape(edge);

  const server = createEdgeControlServer({ autoAlert: true, alertRecipients: ['security@example.com'] });
  server.registerOperator(mark);
  server.registerOperator(john);

  log('== 1. subscribe CanonicalEvent (fonte edge) ==');
  const normal = edge.push({
    objectName: 'packetLog',
    primaryKey: 'a1',
    principal: john.id,
    payload: {
      actionType: 'view packet log',
      location: 'nyc',
      displayName: john.displayName,
      operatorId: john.id,
      amountKB: 100,
    },
    occurredAt: '2024-06-01T12:00:00.000Z',
  });
  assertCanonicalEvent(normal);

  const tx = edge.push({
    objectName: 'packetLog',
    primaryKey: 'a2',
    principal: mark.id,
    payload: {
      actionType: 'data transmission',
      location: 'madrid',
      displayName: mark.displayName,
      operatorId: mark.id,
      amountKB: 2123,
      sourceIP: '1.2.3.4',
      destinationIP: '5.6.7.8',
    },
    occurredAt: '2016-06-09T23:44:00.000Z',
  });
  assertCanonicalEvent(tx);

  const ca1 = edge.push({
    objectName: 'sslCertificateAuthority',
    primaryKey: 'a3',
    principal: mark.id,
    payload: {
      actionType: 'modify certificate authority',
      location: 'nyc',
      displayName: mark.displayName,
      operatorId: mark.id,
      certificateName: 'new-ca.crt',
    },
    occurredAt: '2024-06-01T12:00:00.000Z',
  });
  assertCanonicalEvent(ca1);

  const subscribed: string[] = [];
  for await (const ev of edge.subscribe!({ token: '0' })) {
    subscribed.push(ev.event_id);
    server.ingest(ev);
  }
  log(`  events=${subscribed.length} envelope=CanonicalEvent`);

  log('== 2. dashboard (consistência) ==');
  const view = server.dashboard({
    start: '2016-01-01T00:00:00.000Z',
    end: '2025-01-01T00:00:00.000Z',
  });
  for (const row of view.activities) {
    log(`  ${row.userIdentifier} ${row.actionType} consistent=${row.isConsistentWithBaseline}`);
  }

  log('== 3. first-time CA + transmissão com baseline ==');
  const firstTime = server.anomalies().filter((a) => a.reason.includes('first time'));
  const transmissions = server.transmissions();
  const withBaseline = transmissions.find((t) => t.detailedView.baselineProfileDisplay.typicalLocation === 'nyc');
  log(`  firstTimeCA=${firstTime.length} tx=${transmissions.length} baselineInView=${Boolean(withBaseline)}`);

  const ca2ev = edge.push({
    objectName: 'sslCertificateAuthority',
    primaryKey: 'a4',
    principal: mark.id,
    payload: {
      actionType: 'modify certificate authority',
      location: 'nyc',
      displayName: mark.displayName,
      operatorId: mark.id,
      certificateName: 'new-ca.crt',
    },
    occurredAt: '2024-06-01T13:00:00.000Z',
  });
  const second = server.ingest(ca2ev);
  const secondFirstTime = second.anomalies.some((a) => a.reason.includes('first time'));
  log(`  secondCA firstTime=${secondFirstTime}`);

  if (view.anomalies[0]) {
    server.acknowledge(view.anomalies[0].id);
    server.takeRemedialAction(view.anomalies[0].id, 'Blocked access');
  }

  const johnRow = view.activities.find((r) => r.userIdentifier === 'John');
  const markTx = view.activities.find((r) => r.actionType === 'data transmission');
  const ok =
    subscribed.length === 3 &&
    johnRow?.isConsistentWithBaseline === true &&
    markTx?.isConsistentWithBaseline === false &&
    firstTime.length >= 1 &&
    withBaseline?.detailedView.amountKB === 2123 &&
    withBaseline.detailedView.sourceIP === '1.2.3.4' &&
    secondFirstTime === false &&
    edge.capabilities.includes('subscribe') &&
    !JSON.stringify(view).includes('production_planning');

  log(ok ? '== demo ok (CanonicalEvent, sem domínio) ==' : '== demo FAIL ==');
  return ok ? 0 : 1;
}

export async function runCommandLine(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return 0;
  }
  if (cmd === 'demo') return runDemo(log);
  error(`comando desconhecido: ${cmd}`);
  log(USAGE);
  return 1;
}

function isMain(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
