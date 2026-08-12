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
    expect(audit.list().some((e) => e.id === r.auditEntryId)).toBe(true);
  });
});
