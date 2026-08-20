/**
 * approverPolicy is a namespaced resource; partial/deny write nothing.
 */
import { describe, expect, it } from 'vitest';

import type { AuthzDecision, AuthorizeFn, AuthorizeResult } from 'contracts';
import { createPolicyRuntimeFromOverlay, ResourceIds } from 'policy-engine';

import { createMemoryActionExecutionStore } from '../src/index.js';
import { executorHarness } from './executor-harness.js';

const gated = {
  id: 'act.discount',
  apiName: 'discount',
  displayName: 'Discount',
  inputObjectTypeIds: ['ot.order'],
  requiresApproval: true,
  approvals: { required: true, approverPolicy: 'manager' },
  parameters: {
    orderId: { baseType: 'string' as const, required: true },
    note: { baseType: 'string' as const, required: false },
  },
  rules: [
    {
      kind: 'create_object' as const,
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      propertiesFromParams: { note: 'note' },
    },
  ],
};

function decision(d: AuthzDecision): AuthorizeResult {
  return {
    decision: d,
    principalEpids: d === 'deny' ? [] : ['e'],
    resourceEpid: d === 'deny' ? null : 'e',
    reason: d,
  };
}

describe('approverPolicy authorization', () => {
  it('apply matrix deny|partial|allow — partial writes zero objects', async () => {
    for (const d of ['deny', 'partial', 'allow'] as const) {
      const { exec, objects, ontologyId } = await executorHarness([gated], {
        authorize: () => decision(d),
      });
      const r = await exec.apply({
        ontologyId,
        actionApiName: 'discount',
        parameters: { orderId: `pk-${d}`, note: '10%' },
        principal: 'u1',
        idempotencyKey: `apply-${d}`,
      });
      const obj = await objects.get(ontologyId, 'ot.order', `pk-${d}`);
      if (d === 'allow') {
        expect(r.status).toBe('AWAITING_APPROVAL');
        expect(obj).toBeUndefined();
      } else {
        expect(r.status).toBe('DENIED');
        expect(obj).toBeUndefined();
      }
    }
  });

  it('resume/approve/reject matrix: manager allow, common deny, partial zero writes, no self-approve', async () => {
    const { exec, objects, ontologyId } = await executorHarness([gated], {
      authorize: (req) => {
        if (String(req.resource).startsWith('approver:')) {
          if (req.principal === 'manager') return decision('allow');
          if (req.principal === 'partial-user') return decision('partial');
          return decision('deny');
        }
        return decision('allow');
      },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'd1', note: '10%' },
      principal: 'u1',
      idempotencyKey: 'disc-d1',
    });
    expect(paused.status).toBe('AWAITING_APPROVAL');

    await expect(exec.approve!(paused.executionId, 'u1')).rejects.toThrow(/self-approval/);
    await expect(exec.approve!(paused.executionId, 'eve')).rejects.toThrow();
    await expect(exec.approve!(paused.executionId, 'partial-user')).rejects.toThrow();
    expect(await objects.get(ontologyId, 'ot.order', 'd1')).toBeUndefined();

    const done = await exec.approve!(paused.executionId, 'manager');
    expect(done.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', 'd1'))?.properties.note).toBe('10%');

    const paused2 = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'd2' },
      principal: 'u1',
      idempotencyKey: 'disc-d2',
    });
    await expect(exec.reject!(paused2.executionId, 'eve')).rejects.toThrow();
    const rejectedEve = await exec.getExecution(paused2.executionId);
    expect(rejectedEve?.status).toBe('AWAITING_APPROVAL');
    const rejected = await exec.reject!(paused2.executionId, 'manager');
    expect(rejected.status).toBe('REJECTED');
  });

  it('missing approverPolicy denies approve with zero object writes', async () => {
    const { exec, objects, ontologyId } = await executorHarness([
      { ...gated, approvals: { required: true } },
    ]);
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'd3', note: 'x' },
      principal: 'u1',
      idempotencyKey: 'disc-d3',
    });
    expect(paused.status).toBe('AWAITING_APPROVAL');
    await expect(exec.approve!(paused.executionId, 'manager')).rejects.toThrow(/approverPolicy/);
    expect(await objects.get(ontologyId, 'ot.order', 'd3')).toBeUndefined();
  });

  it('compiled overlay: only manager grant may approve', async () => {
    const seed = await executorHarness([gated]);
    const policy = createPolicyRuntimeFromOverlay(
      {
        roles: { u1: ['ops'], manager: ['mgr'], eve: ['ops'] },
        grants: [
          {
            role: 'ops',
            ontologyIds: [seed.ontologyId],
            actions: ['discount'],
            objectTypes: ['ot.order'],
            operations: ['read', 'modify'],
          },
          {
            role: 'mgr',
            ontologyIds: [seed.ontologyId],
            approverPolicies: ['manager'],
            actions: ['discount'],
            objectTypes: ['ot.order'],
            operations: ['read', 'modify'],
          },
        ],
      },
      {
        catalog: {
          ontologies: [seed.ontologyId],
          objectTypes: [{ ontologyId: seed.ontologyId, id: 'ot.order' }],
          linkTypes: [],
          actions: [{ ontologyId: seed.ontologyId, apiName: 'discount' }],
          functions: [],
          admin: [],
          approverPolicies: [{ ontologyId: seed.ontologyId, id: 'manager' }],
        },
      },
    );
    expect(
      policy.authorize({
        principal: 'manager',
        resource: ResourceIds.approver(seed.ontologyId, 'manager'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({
        principal: 'eve',
        resource: ResourceIds.approver(seed.ontologyId, 'manager'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
  });

  it('two approvers still yield one CAS winner', async () => {
    const authorize: AuthorizeFn = (req) => {
      if (String(req.resource).startsWith('approver:')) {
        return req.principal === 'u1' ? decision('deny') : decision('allow');
      }
      return decision('allow');
    };
    const { exec, objects, ontologyId } = await executorHarness([gated], { authorize });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'cas', note: '1' },
      principal: 'u1',
      idempotencyKey: 'cas-1',
    });
    const [a, b] = await Promise.all([
      exec.approve!(paused.executionId, 'manager'),
      exec.approve!(paused.executionId, 'manager-2'),
    ]);
    expect([a.status, b.status].includes('SUCCEEDED')).toBe(true);
    expect(a.executionId).toBe(b.executionId);
    expect((await objects.get(ontologyId, 'ot.order', 'cas'))?.properties.note).toBe('1');
    expect((await objects.get(ontologyId, 'ot.order', 'cas'))?.version).toBe(1);
  });

  it('approve without casStatus still writes once via save', async () => {
    const inner = createMemoryActionExecutionStore();
    const { casStatus: _omit, ...executions } = inner;
    void _omit;
    const { exec, objects, ontologyId } = await executorHarness([gated], {
      executions,
      authorize: (req) => {
        if (String(req.resource).startsWith('approver:')) {
          return req.principal === 'u1' ? decision('deny') : decision('allow');
        }
        return decision('allow');
      },
    });
    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'save-path', note: 'n' },
      principal: 'u1',
      idempotencyKey: 'save-1',
    });
    const done = await exec.approve!(paused.executionId, 'manager');
    expect(done.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', 'save-path'))?.properties.note).toBe('n');
  });

  it('approve unknown id fails closed; terminal replay writes nothing extra', async () => {
    const { exec, objects, ontologyId } = await executorHarness([gated], {
      authorize: (req) => {
        if (String(req.resource).startsWith('approver:')) {
          return req.principal === 'u1' ? decision('deny') : decision('allow');
        }
        return decision('allow');
      },
    });
    const missing = await exec.approve!('missing', 'manager');
    expect(missing.status).toBe('FAILED');
    expect(missing.error).toMatch(/unknown execution/);

    const paused = await exec.apply({
      ontologyId,
      actionApiName: 'discount',
      parameters: { orderId: 'replay', note: 'n' },
      principal: 'u1',
      idempotencyKey: 'replay-1',
    });
    const done = await exec.approve!(paused.executionId, 'manager');
    expect(done.status).toBe('SUCCEEDED');
    const replay = await exec.approve!(paused.executionId, 'manager-2');
    expect(replay.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', 'replay'))?.version).toBe(1);
  });

  it('resume without actionTypeHash fails closed with zero object writes', async () => {
    const executions = createMemoryActionExecutionStore();
    const { exec, objects, ontology, ontologyId } = await executorHarness([gated], {
      executions,
      authorize: (req) => {
        if (String(req.resource).startsWith('approver:')) {
          return req.principal === 'u1' ? decision('deny') : decision('allow');
        }
        return decision('allow');
      },
    });
    const version = await ontology.getLatestVersion(ontologyId);
    await executions.save({
      id: 'unpinned',
      ontologyId,
      actionTypeId: 'act.discount',
      actionApiName: 'discount',
      parameters: { orderId: 'unpinned', note: 'x' },
      principal: 'u1',
      status: 'AWAITING_APPROVAL',
      startedAt: 't0',
      ontologyVersionId: version?.id,
      approval: { required: true, requestedAt: 't0' },
    });
    const r = await exec.approve!('unpinned', 'manager');
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/pinned/);
    expect(await objects.get(ontologyId, 'ot.order', 'unpinned')).toBeUndefined();
  });
});
