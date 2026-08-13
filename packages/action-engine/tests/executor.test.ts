/**
 * action-engine — tests/executor.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  createDeterministicClock,
  createIdGenerator,
  createMemoryLinkRepository,
  createMemoryObjectRepository,
} from 'object-platform';
import { createAuditLog } from 'policy-engine';

import { createActionExecutor } from '../src/index.js';

describe('ActionExecutor', () => {
  it('validate → apply → modify + audit', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const objects = createMemoryObjectRepository({ clock, nextId });
    const links = createMemoryLinkRepository({ clock, nextId });
    const audit = createAuditLog({ clock, nextId });

    await objects.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });

    const exec = createActionExecutor({
      objects,
      links,
      audit,
      clock,
      nextId,
      actionTypes: {
        o1: [
          {
            id: 'act.approve',
            apiName: 'approve',
            displayName: 'Approve',
            inputObjectTypeIds: ['ot.order'],
            parameters: {
              orderId: { baseType: 'object_reference', objectTypeId: 'ot.order', required: true },
              status: { baseType: 'string', required: true },
            },
            submissionCriteria: [
              {
                kind: 'property_equals',
                objectTypeId: 'ot.order',
                primaryKeyParam: 'orderId',
                propertyTypeId: 'status',
                equals: 'pending',
              },
            ],
            rules: [
              {
                kind: 'modify_object',
                objectTypeId: 'ot.order',
                primaryKeyFromParam: 'orderId',
                setPropertiesFromParams: { status: 'status' },
              },
            ],
          },
        ],
      },
    });

    const v = await exec.validate({
      ontologyId: 'o1',
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
    });
    expect(v.valid).toBe(true);

    const r = await exec.apply({
      ontologyId: 'o1',
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
    });
    expect(r.status).toBe('SUCCEEDED');
    expect((await objects.get('o1', 'ot.order', '1'))?.properties.status).toBe('ok');
    expect((await audit.list()).some((e) => e.id === r.auditEntryId)).toBe(true);
  });

  it('expectedObjectVersions is enforced on the mutation CAS, not only pre-check', async () => {
    const clock = createDeterministicClock();
    const nextId = createIdGenerator();
    const inner = createMemoryObjectRepository({ clock, nextId });
    let seenExpected: number | undefined;
    const objects = {
      create: inner.create.bind(inner),
      get: inner.get.bind(inner),
      getById: inner.getById.bind(inner),
      list: inner.list.bind(inner),
      async update(
        ontologyId: string,
        objectTypeId: string,
        primaryKey: string,
        input: { properties: Record<string, unknown>; expectedVersion?: number },
      ) {
        seenExpected = input.expectedVersion;
        return inner.update(ontologyId, objectTypeId, primaryKey, input);
      },
      delete: inner.delete.bind(inner),
    };
    const links = createMemoryLinkRepository({ clock, nextId });
    const audit = createAuditLog({ clock, nextId });

    await inner.create({
      ontologyId: 'o1',
      objectTypeId: 'ot.order',
      primaryKey: '1',
      properties: { status: 'pending' },
    });
    await inner.update('o1', 'ot.order', '1', { properties: { status: 'pending' } });

    const exec = createActionExecutor({
      objects,
      links,
      audit,
      clock,
      nextId,
      actionTypes: {
        o1: [
          {
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
          },
        ],
      },
    });

    const stale = await exec.apply({
      ontologyId: 'o1',
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      expectedObjectVersions: { 'ot.order::1': 1 },
    });
    expect(stale.status).toBe('FAILED');
    expect(stale.error).toMatch(/version conflict/i);
    expect((await inner.get('o1', 'ot.order', '1'))?.version).toBe(2);

    const ok = await exec.apply({
      ontologyId: 'o1',
      actionApiName: 'approve',
      parameters: { orderId: '1', status: 'ok' },
      principal: 'u1',
      expectedObjectVersions: { 'ot.order::1': 2 },
    });
    expect(ok.status).toBe('SUCCEEDED');
    expect(seenExpected).toBe(2);
  });
});
