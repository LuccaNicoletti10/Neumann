/**
 * edge-control — tests/passo32.test.ts
 */
import { describe, expect, it } from 'vitest';

import { assertCanonicalEvent } from 'contracts';
import type { EdgeOperator } from 'contracts';
import { asConnectorV2, assertConnectorShape, validateConnectorShape } from 'connector-sdk';

import { runDemo } from '../src/cli.js';
import { createMemoryEdgeConnector } from '../src/core/connector.js';
import { createEdgeControlServer } from '../src/core/server.js';

const mark: EdgeOperator = {
  id: 'op-mark',
  displayName: 'Mark',
  typicalLocation: 'nyc',
  workHoursStart: 9,
  workHoursEnd: 17,
};

describe('Passo 32 — edge / supervisory control', () => {
  it('CLI demo exit 0', async () => {
    const lines: string[] = [];
    expect(await runDemo((m) => lines.push(m))).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });

  it('subscribe emite CanonicalEvent (mesmo envelope)', async () => {
    const edge = createMemoryEdgeConnector();
    assertConnectorShape(edge);
    expect(edge.capabilities).toContain('subscribe');
    edge.push({
      objectName: 'packetLog',
      primaryKey: '1',
      principal: 'op-1',
      payload: { actionType: 'view', location: 'nyc' },
    });
    const got = [];
    for await (const ev of edge.subscribe!()) {
      assertCanonicalEvent(ev);
      got.push(ev);
    }
    expect(got).toHaveLength(1);
    expect(got[0]?.source_system).toBe('edge');
    expect(got[0]?.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('capability subscribe sem método falha no SDK', () => {
    const edge = createMemoryEdgeConnector();
    const bad = { ...edge, capabilities: ['subscribe'] as const, subscribe: undefined };
    expect(validateConnectorShape(bad).ok).toBe(false);
  });

  it('asConnectorV2 encaminha subscribe', async () => {
    const edge = createMemoryEdgeConnector();
    edge.push({
      objectName: 'smtpLog',
      primaryKey: 'm1',
      principal: 'op-1',
      payload: { actionType: 'view', location: 'nyc' },
    });
    const v2 = asConnectorV2(edge);
    expect(typeof v2.subscribe).toBe('function');
    const records = [];
    for await (const msg of v2.subscribe!({})) {
      if (msg.type === 'RECORD') records.push(msg.record);
    }
    expect(records).toHaveLength(1);
  });

  it('atividade normal não gera anomalia; local/hora/volume sim', () => {
    const server = createEdgeControlServer({ autoAlert: false });
    server.registerOperator(mark);
    const edge = createMemoryEdgeConnector();
    const okEv = edge.push({
      objectName: 'packetLog',
      primaryKey: 'n1',
      principal: mark.id,
      payload: { actionType: 'view', location: 'nyc', displayName: 'Mark' },
      occurredAt: '2024-06-01T12:00:00.000Z',
    });
    expect(server.ingest(okEv).anomalies).toHaveLength(0);

    const bad = edge.push({
      objectName: 'packetLog',
      primaryKey: 'n2',
      principal: mark.id,
      payload: {
        actionType: 'data transmission',
        location: 'madrid',
        displayName: 'Mark',
        amountKB: 5000,
        sourceIP: '1.2.3.4',
        destinationIP: '5.6.7.8',
      },
      occurredAt: '2024-06-01T03:00:00.000Z',
    });
    const anomalies = server.ingest(bad).anomalies;
    expect(anomalies.some((a) => a.reason.includes('madrid'))).toBe(true);
    expect(anomalies.some((a) => a.reason.includes('outside typical'))).toBe(true);
    expect(anomalies.some((a) => a.reason.includes('unusually large'))).toBe(true);
  });

  it('first-time CA; segunda vez não dispara first time', () => {
    const server = createEdgeControlServer({ autoAlert: false });
    server.registerOperator(mark);
    const edge = createMemoryEdgeConnector();
    const a1 = edge.push({
      objectName: 'sslCertificateAuthority',
      primaryKey: 'ca1',
      principal: mark.id,
      payload: {
        actionType: 'modify certificate authority',
        location: 'nyc',
        displayName: 'Mark',
        certificateName: 'new-ca',
      },
      occurredAt: '2024-06-01T12:00:00.000Z',
    });
    const first = server.ingest(a1).anomalies;
    expect(first.some((a) => a.reason.includes('first time'))).toBe(true);
    expect(server.baselines().hasModifiedCA(mark.id, 'new-ca')).toBe(true);

    const a2 = edge.push({
      objectName: 'sslCertificateAuthority',
      primaryKey: 'ca2',
      principal: mark.id,
      payload: {
        actionType: 'modify certificate authority',
        location: 'nyc',
        displayName: 'Mark',
        certificateName: 'new-ca',
      },
      occurredAt: '2024-06-01T12:05:00.000Z',
    });
    const second = server.ingest(a2).anomalies;
    expect(second.some((a) => a.reason.includes('first time'))).toBe(false);
  });

  it('transmissão digital inclui detailedView + porção do baseline', () => {
    const server = createEdgeControlServer({ autoAlert: false });
    server.registerOperator(mark);
    const edge = createMemoryEdgeConnector();
    const ev = edge.push({
      objectName: 'packetLog',
      primaryKey: 't1',
      principal: mark.id,
      payload: {
        actionType: 'data transmission',
        location: 'madrid',
        displayName: 'Mark',
        amountKB: 2123,
        sourceIP: '1.2.3.4',
        destinationIP: '5.6.7.8',
      },
      occurredAt: '2016-06-09T23:44:00.000Z',
    });
    const anomalies = server.ingest(ev).anomalies;
    const tx = server.sendAlert(anomalies[0]!, 'urgentMessage', ['admin@example.com']);
    expect(tx.detailedView.actionType).toBe('data transmission');
    expect(tx.detailedView.userIdentifier).toBe('Mark');
    expect(tx.detailedView.amountKB).toBe(2123);
    expect(tx.detailedView.sourceIP).toBe('1.2.3.4');
    expect(tx.detailedView.baselineProfileDisplay.typicalLocation).toBe('nyc');
    expect(tx.detailedView.baselineProfileDisplay.typicalWorkHours).toBe('9:00-17:00');
  });

  it('dashboard: cada linha tem time/action/user/consistência', () => {
    const server = createEdgeControlServer({ autoAlert: false });
    server.registerOperator(mark);
    const edge = createMemoryEdgeConnector();
    const a1 = edge.push({
      objectName: 'packetLog',
      primaryKey: 'd1',
      principal: mark.id,
      payload: { actionType: 'view', location: 'nyc', displayName: 'Mark' },
      occurredAt: '2024-06-01T12:00:00.000Z',
    });
    const a2 = edge.push({
      objectName: 'packetLog',
      primaryKey: 'd2',
      principal: mark.id,
      payload: { actionType: 'data transmission', location: 'madrid', displayName: 'Mark', amountKB: 5000 },
      occurredAt: '2024-06-01T12:01:00.000Z',
    });
    server.ingest(a1);
    server.ingest(a2);
    const view = server.dashboard({
      start: '2024-06-01T00:00:00.000Z',
      end: '2024-06-02T00:00:00.000Z',
    });
    expect(view.activities).toHaveLength(2);
    expect(view.activities[0]?.isConsistentWithBaseline).toBe(true);
    expect(view.activities[1]?.isConsistentWithBaseline).toBe(false);
    for (const row of view.activities) {
      expect(row.time).toBeTruthy();
      expect(row.actionType).toBeTruthy();
      expect(row.userIdentifier).toBe('Mark');
    }
  });

  it('acknowledge + remedial', () => {
    const server = createEdgeControlServer({ autoAlert: false });
    server.registerOperator(mark);
    const edge = createMemoryEdgeConnector();
    const ev = edge.push({
      objectName: 'packetLog',
      primaryKey: 'r1',
      principal: mark.id,
      payload: { actionType: 'data transmission', location: 'madrid', displayName: 'Mark', amountKB: 5000 },
      occurredAt: '2024-06-01T03:00:00.000Z',
    });
    const anom = server.ingest(ev).anomalies[0]!;
    expect(anom.acknowledged).toBe(false);
    server.acknowledge(anom.id);
    server.takeRemedialAction(anom.id, 'Blocked user access');
    expect(server.anomalies()[0]?.acknowledged).toBe(true);
    expect(server.anomalies()[0]?.remedialAction).toBe('Blocked user access');
  });
});
