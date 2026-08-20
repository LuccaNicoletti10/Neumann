/**
 * Closed loop: ERP simulator → Neumann object → Action → outbox → HTTP writeback → ERP → re-observe.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionTypeDef } from 'contracts';
import {
  createHttpWritebackConnector,
  createOutboxWorker,
  createPgOutboxRepository,
  createPgWritebackExecutionStore,
  createWritebackHandler,
} from 'event-bus';
import { tryOpenIsolatedPg } from 'object-platform';
import { createPostgresPlatformContext } from 'platform-api';
import { createAllowAllTestPolicy } from 'policy-engine';

import { listenErpSimulator } from '../src/server.js';

const approve: ActionTypeDef = {
  id: 'act.approve',
  apiName: 'approve',
  displayName: 'Approve',
  inputObjectTypeIds: ['ot.order'],
  parameters: {
    orderId: { baseType: 'object_reference', objectTypeId: 'ot.order', required: true },
    status: { baseType: 'string', required: true },
  },
  rules: [
    {
      kind: 'modify_object',
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      setPropertiesFromParams: { status: 'status' },
    },
  ],
  sideEffects: [{ kind: 'connector_writeback', connectorId: 'erp', operation: 'update' }],
};

const db = await tryOpenIsolatedPg();

describe.skipIf(!db)('closed-loop E2E', () => {
  afterAll(async () => {
    await db?.close();
  });

  it('ERP observe → Action → HTTP writeback → ERP + Neumann converge', async () => {
    if (!db) return;
    const sim = await listenErpSimulator({
      seed: (s) => {
        s.orders.set('O1', { id: 'O1', status: 'pending', quantity: 2 });
      },
    });
    try {
      const observed = (await (await fetch(`${sim.url}/orders/O1`)).json()) as {
        id: string;
        status: string;
        quantity?: number;
      };
      expect(observed.status).toBe('pending');

      const ctx = await createPostgresPlatformContext({
        sql: db.sql,
        transaction: db.sql,
        policy: createAllowAllTestPolicy(),
      });
      const onto = await ctx.ontology.createOntology({ name: 'loop' });
      await ctx.ontology.addPropertyType(onto.id, {
        id: 'status',
        displayName: 'Status',
        baseType: 'string',
      });
      await ctx.ontology.addPropertyType(onto.id, {
        id: 'quantity',
        displayName: 'Qty',
        baseType: 'number',
      });
      await ctx.ontology.addObjectType(onto.id, {
        id: 'ot.order',
        displayName: 'Order',
        propertyTypeIds: ['status', 'quantity'],
      });
      await ctx.ontology.addActionType(onto.id, approve);
      await ctx.ontology.commit({ ontologyId: onto.id, createdBy: 'loop' });

      await ctx.projections.projectObject({
        ontologyId: onto.id,
        objectTypeId: 'ot.order',
        primaryKey: String(observed.id),
        properties: { status: observed.status, quantity: observed.quantity },
        source: 'erp-simulator',
        sourceEventId: `observe-${observed.id}-pending`,
        principal: 'svc-projector',
      });

      const applied = await ctx.actions.apply({
        ontologyId: onto.id,
        actionApiName: 'approve',
        parameters: { orderId: 'O1', status: 'ok' },
        principal: 'alice',
        idempotencyKey: 'loop-approve',
        expectedObjectVersions: { 'ot.order::O1': 1 },
      });
      expect(applied.status).toBe('SUCCEEDED');
      expect((await ctx.objects.get(onto.id, 'ot.order', 'O1'))?.properties.status).toBe('ok');

      const executions = createPgWritebackExecutionStore({ sql: db.sql });
      const worker = createOutboxWorker({
        dispatcher: createPgOutboxRepository({ sql: db.sql }),
        handlers: {
          'action.side_effect.writeback': createWritebackHandler({
            connector: createHttpWritebackConnector({ baseUrl: sim.url }),
            executions,
          }),
        },
      });
      expect(await worker.drainOnce()).toBeGreaterThanOrEqual(1);

      const erpAfter = (await (await fetch(`${sim.url}/orders/O1`)).json()) as {
        id: string;
        status: string;
        quantity?: number;
      };
      expect(erpAfter.status).toBe('ok');

      const reobserved = (await (await fetch(`${sim.url}/orders/O1`)).json()) as {
        id: string;
        status: string;
        quantity?: number;
      };
      await ctx.projections.projectObject({
        ontologyId: onto.id,
        objectTypeId: 'ot.order',
        primaryKey: 'O1',
        properties: { status: reobserved.status, quantity: reobserved.quantity },
        source: 'erp-simulator',
        sourceEventId: `observe-O1-${reobserved.status}`,
        principal: 'svc-projector',
        expectedVersion: 2,
      });
      const converged = await ctx.objects.get(onto.id, 'ot.order', 'O1');
      expect(converged?.properties.status).toBe(erpAfter.status);
      expect(converged?.properties.quantity).toBe(erpAfter.quantity);

      const wb = await executions.listByEvent(
        (
          await db.sql.query<{ event_id: string }>(
            `SELECT event_id FROM outbox_events
             WHERE topic = 'action.side_effect.writeback'
             ORDER BY created_at DESC LIMIT 1`,
          )
        ).rows[0]!.event_id,
      );
      expect(wb.some((e) => e.status === 'SUCCEEDED' && e.idempotencyKey.startsWith('neumann:'))).toBe(
        true,
      );
    } finally {
      await sim.app.close();
    }
  });
});
