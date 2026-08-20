/**
 * Overlay selectors are independent and ontology-scoped. actions:* is not admin.
 */
import { describe, expect, it } from 'vitest';

import {
  compileOverlayToEpid,
  createPolicyRuntimeFromOverlay,
  KERNEL_ONTOLOGY,
  ResourceIds,
  type PolicyResourceCatalog,
} from '../src/index.js';

function catalog(): PolicyResourceCatalog {
  return {
    ontologies: ['oa', 'ob', 'o1'],
    objectTypes: [
      { ontologyId: 'oa', id: 'ot.shared' },
      { ontologyId: 'ob', id: 'ot.shared' },
      { ontologyId: 'o1', id: 'ot.order' },
    ],
    linkTypes: [
      { ontologyId: 'oa', id: 'lt.x' },
      { ontologyId: 'o1', id: 'lt.x' },
    ],
    actions: [
      { ontologyId: 'o1', apiName: 'approve' },
      { ontologyId: 'oa', apiName: 'ping' },
    ],
    functions: [{ ontologyId: 'o1', id: 'fn.x' }],
    admin: [],
    approverPolicies: [{ ontologyId: 'o1', id: 'manager' }],
  };
}

describe('scoped overlay grants', () => {
  it('two ontologies with the same type id keep separate permissions and redactions', () => {
    const policy = createPolicyRuntimeFromOverlay(
      {
        roles: { alice: ['a', 'b'] },
        grants: [
          {
            role: 'a',
            ontologyIds: ['oa'],
            objectTypes: ['ot.shared'],
            operations: ['read', 'modify'],
            hiddenProperties: ['secretA'],
          },
          {
            role: 'b',
            ontologyIds: ['ob'],
            objectTypes: ['ot.shared'],
            operations: ['read'],
            hiddenProperties: ['secretB'],
          },
        ],
      },
      { catalog: catalog() },
    );
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.objectType('oa', 'ot.shared'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.objectType('ob', 'ot.shared'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
    expect(
      policy.redactProperties('alice', 'ot.shared', { n: 1, secretA: 'a', secretB: 'b' }, 'oa'),
    ).toEqual({ n: 1, secretB: 'b' });
    expect(
      policy.redactProperties('alice', 'ot.shared', { n: 1, secretA: 'a', secretB: 'b' }, 'ob'),
    ).toEqual({ n: 1, secretA: 'a' });
  });

  it("actions:['*'] grants only Actions — not Functions, admin, projection, or ontology modify", () => {
    const policy = createPolicyRuntimeFromOverlay(
      {
        everyoneRole: 'world',
        roles: {},
        grants: [{ role: 'world', ontologyIds: ['o1'], actions: ['*'] }],
      },
      { catalog: catalog() },
    );
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.action('o1', 'approve'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.function('o1', 'fn.x'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
    for (const admin of ['projection', 'ingest', 'function.execute', 'ontology.write', 'action-execution']) {
      expect(
        policy.authorize({
          principal: 'x',
          resource: ResourceIds.admin(admin),
          operation: 'modify',
        }).decision,
        admin,
      ).toBe('deny');
    }
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.ontology('o1'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.approver('o1', 'manager'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.objectType('o1', 'ot.order'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
  });

  it('objectTypes do not select LinkTypes; omitted new selectors stay empty', () => {
    const policy = createPolicyRuntimeFromOverlay(
      {
        everyoneRole: 'world',
        roles: {},
        grants: [
          {
            role: 'world',
            ontologyIds: ['o1'],
            objectTypes: ['lt.x', 'ot.order'],
            operations: ['read', 'modify'],
          },
        ],
      },
      { catalog: catalog() },
    );
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.objectType('o1', 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({
        principal: 'x',
        resource: ResourceIds.linkType('o1', 'lt.x'),
        operation: 'read',
      }).decision,
    ).toBe('deny');
  });

  it('legacy overlay without new fields does not gain Functions or admin', () => {
    const compiled = compileOverlayToEpid(
      {
        everyoneRole: 'world',
        roles: {},
        grants: [{ role: 'world', actions: ['*'], objectTypes: ['*'] }],
      },
      catalog(),
    );
    const resources = compiled.nodes.map((n) => n.resourceId);
    expect(resources.some((r) => r.startsWith('function:'))).toBe(false);
    expect(resources.some((r) => r.includes('admin:projection'))).toBe(false);
    expect(resources.some((r) => r.includes('admin:function.execute'))).toBe(false);
    expect(
      resources.some((r) => r.startsWith(`object:${encodeURIComponent(KERNEL_ONTOLOGY)}/`)),
    ).toBe(false);
  });
});
