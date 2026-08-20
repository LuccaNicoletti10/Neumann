/**
 * action-engine — tests/passo24.test.ts
 * Gate: unauthorized → DENIED; duplicate idempotencyKey → 1 execução;
 * stale object → conflict; audit completo.
 */

import { describe, expect, it } from 'vitest';

import type { ActionTypeDef, ActionWorkflowDef } from 'contracts';

import { runDemo } from '../src/cli.js';
import { renderDocumentTemplate } from '../src/core/document-template.js';
import {
  bindParameterVariable,
  buildParameterTree,
  setVariable,
} from '../src/core/parameter-tree.js';
import {
  createActionWorkflowRunner,
  dependentSteps,
  topologicalSteps,
} from '../src/core/workflow.js';
import { executorHarness } from './executor-harness.js';

async function harness(actionTypes: ActionTypeDef[], authorizeEve = false) {
  return executorHarness(actionTypes, {
    authorize: (req) =>
      authorizeEve && req.principal === 'eve'
        ? { decision: 'deny', principalEpids: [], resourceEpid: null, reason: 'unauthorized' }
        : { decision: 'allow', principalEpids: [], resourceEpid: null, reason: 'ok' },
  });
}

const approve: ActionTypeDef = {
  id: 'act.approve',
  apiName: 'approve',
  displayName: 'Approve',
  inputObjectTypeIds: ['ot.order'],
  parameters: {
    orderId: { baseType: 'object_reference', objectTypeId: 'ot.order', required: true },
    status: { baseType: 'string', required: true, variableName: 'order_status' },
  },
  rules: [
    {
      kind: 'modify_object',
      objectTypeId: 'ot.order',
      primaryKeyFromParam: 'orderId',
      setPropertiesFromParams: { status: 'status' },
    },
  ],
};

describe('Passo 24 — Action engine', () => {
  it('unauthorized → DENIED with audit', async () => {
    const { objects, exec, audit, ontologyId } = await harness([approve], true);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'eve',
      idempotencyKey: 'deny-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(r.status).toBe('DENIED');
    expect(r.error).toMatch(/unauthorized/);
    expect(r.auditEntryId).toBeTruthy();
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
    const kinds = (await audit.list())
      .map((e) => {
        try {
          return JSON.parse(e.eventData ?? '{}') as { kind?: string };
        } catch {
          return {};
        }
      })
      .map((p) => p.kind);
    expect(kinds).toContain('ActionDenied');
  });

  it('duplicate idempotencyKey → 1 execution', async () => {
    const { objects, exec, ontologyId } = await harness([approve]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const a = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    const b = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'k1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(a.status).toBe('SUCCEEDED');
    expect(b.executionId).toBe(a.executionId);
    expect(b.status).toBe('SUCCEEDED');
  });

  it('stale object → conflict + audit', async () => {
    const { objects, exec, audit, ontologyId } = await harness([approve]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'stale-99',
      expectedObjectVersions: { 'ot.order::1': 99 },
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/version conflict/i);
    expect(r.auditEntryId).toBeTruthy();
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
    const kinds = (await audit.list())
      .map((e) => {
        try {
          return JSON.parse(e.eventData ?? '{}') as { kind?: string };
        } catch {
          return {};
        }
      })
      .map((p) => p.kind);
    expect(kinds).toContain('ActionFailed');
  });

  it('postcondition failure runs compensation', async () => {
    const def: ActionTypeDef = {
      ...approve,
      postconditions: [
        {
          kind: 'property_equals',
          objectTypeId: 'ot.order',
          primaryKeyParam: 'orderId',
          propertyTypeId: 'status',
          equals: 'shipped',
        },
      ],
      compensation: [
        {
          kind: 'modify_object',
          objectTypeId: 'ot.order',
          primaryKeyFromParam: 'orderId',
          setPropertiesFromParams: { status: 'revertTo' },
        },
      ],
      parameters: {
        ...approve.parameters,
        revertTo: { baseType: 'string', required: true },
      },
    };
    const { objects, exec, ontologyId } = await harness([def]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok', revertTo: 'pending' },
      principal: 'u1',
      idempotencyKey: 'post-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/postcondition/);
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.status).toBe('pending');
  });

  it('generate_document fills template from object properties', async () => {
    const def: ActionTypeDef = {
      id: 'act.report',
      apiName: 'report',
      displayName: 'Report',
      inputObjectTypeIds: ['ot.order'],
      parameters: {
        orderId: { baseType: 'object_reference', objectTypeId: 'ot.order', required: true },
      },
      rules: [
        {
          kind: 'generate_document',
          objectTypeId: 'ot.order',
          primaryKeyFromParam: 'orderId',
          template: 'Hello {{name}} ({{#each associates}}{{this}};{{/each}})',
          outputProperty: 'doc',
        },
      ],
    };
    const { objects, exec, ontologyId } = await harness([def]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { name: 'Ada', associates: ['Bob', 'Cyd'] },
    });
    const r = await exec.apply({
      ontologyId,
      actionApiName: 'report',
      parameters: { orderId: '1' },
      principal: 'u1',
      idempotencyKey: 'report-1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(r.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', '1'))?.properties.doc).toBe(
      'Hello Ada (Bob;Cyd;)',
    );
  });

  it('parameter tree + variable binding', async () => {
    const { objects, exec, ontologyId } = await harness([approve]);
    await objects.create({
      ontologyId,
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending', amount: 9 },
    });
    const tree = await exec.parameterTree!({
      ontologyId,
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
    });
    expect(tree.nodes.find((n) => n.name === 'orderId')?.children.some((c) => c.name === 'amount')).toBe(
      true,
    );
    const bound = bindParameterVariable(tree, 'status', 'order_status');
    const { params } = setVariable(bound, 'order_status', 'held');
    expect(params.status).toBe('held');
    expect(buildParameterTree(approve, params).nodes.find((n) => n.name === 'status')?.value).toBe(
      'held',
    );
  });

  it('workflow applies steps in dependency order and reprocesses dependents', async () => {
    const create: ActionTypeDef = {
      id: 'act.create',
      apiName: 'create',
      displayName: 'Create',
      inputObjectTypeIds: ['ot.order'],
      parameters: {
        orderId: { baseType: 'string', required: true },
      },
      rules: [
        {
          kind: 'create_object',
          objectTypeId: 'ot.order',
          primaryKeyFromParam: 'orderId',
          propertiesFromParams: {},
        },
      ],
    };
    const { objects, exec, ontologyId } = await harness([create, approve]);
    const runner = createActionWorkflowRunner(exec);
    const workflow: ActionWorkflowDef = {
      id: 'wf',
      displayName: 'wf',
      steps: [
        {
          id: 's1',
          actionApiName: 'create',
          parameterBindings: { orderId: '$orderId' },
        },
        {
          id: 's2',
          actionApiName: 'approve',
          parameterBindings: { orderId: '$orderId', status: '$status' },
          dependsOn: ['s1'],
        },
      ],
    };
    expect(topologicalSteps(workflow).map((s) => s.id)).toEqual(['s1', 's2']);
    expect([...dependentSteps(workflow, 's1')].sort()).toEqual(['s1', 's2']);

    const r = await runner.apply({
      ontologyId,
      workflow,
      parameters: { orderId: 'n1', status: 'ok' },
      principal: 'u1',
      idempotencyKey: 'wf1',
      expectedObjectVersions: { 'ot.order::n1': 1 },
    });
    expect(r.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', 'n1'))?.properties.status).toBe('ok');

    await objects.update(ontologyId, 'ot.order', 'n1', { properties: { status: 'pending' } });
    const rp = await runner.reprocess(
      {
        ontologyId,
        workflow,
        parameters: { orderId: 'n1', status: 'ok' },
        principal: 'u1',
        idempotencyKey: 'wf1-reprocess',
        expectedObjectVersions: { 'ot.order::n1': 3 },
      },
      's2',
    );
    expect(rp.stepResults).toHaveLength(1);
    expect(rp.status).toBe('SUCCEEDED');
    expect((await objects.get(ontologyId, 'ot.order', 'n1'))?.properties.status).toBe('ok');
  });

  it('renderDocumentTemplate is substitution-only', () => {
    expect(renderDocumentTemplate('{{name}}', { name: 'X' })).toBe('X');
    expect(renderDocumentTemplate('{{#each xs}}[{{this}}]{{/each}}', { xs: [1, 2] })).toBe(
      '[1][2]',
    );
  });

  it('cli demo gate', async () => {
    const lines: string[] = [];
    const code = await runDemo((m) => lines.push(m));
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('demo ok'))).toBe(true);
  });
});
