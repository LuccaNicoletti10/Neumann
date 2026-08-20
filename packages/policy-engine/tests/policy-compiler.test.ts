/**
 * Overlay wildcard compilation into EPID — one evaluator, one generation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ALLOW_ALL_POLICY_OVERLAY,
  catalogFromOntology,
  compileOverlayToEpid,
  createAllowAllTestPolicy,
  createMemoryPolicyStore,
  createPolicyRuntime,
  createPolicyRuntimeFromOverlay,
  DENY_ALL_POLICY_OVERLAY,
  emptyCatalog,
  KERNEL_ONTOLOGY,
  parsePolicyCatalog,
  ResourceIds,
  type PolicyResourceCatalog,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function sampleCatalog(): PolicyResourceCatalog {
  return {
    ontologies: ['o1'],
    objectTypes: [
      { ontologyId: 'o1', id: 'ot.order' },
      { ontologyId: 'o1', id: 'ot.secret' },
    ],
    linkTypes: [{ ontologyId: 'o1', id: 'lt.x' }],
    actions: [{ ontologyId: 'o1', apiName: 'approve' }],
    functions: [{ ontologyId: 'o1', id: 'fn.x' }],
    admin: [],
    approverPolicies: [],
  };
}

describe('compileOverlayToEpid', () => {
  it('wildcard and explicit grants produce equivalent object/action decisions', () => {
    const catalog = sampleCatalog();
    const wild = createPolicyRuntimeFromOverlay(
      {
        everyoneRole: 'world',
        roles: {},
        grants: [
          {
            role: 'world',
            ontologyIds: ['o1'],
            objectTypes: ['*'],
            linkTypes: ['*'],
            actions: ['approve'],
            operations: ['read', 'modify'],
          },
        ],
      },
      { catalog },
    );
    const explicit = createPolicyRuntimeFromOverlay(
      {
        everyoneRole: 'world',
        roles: {},
        grants: [
          {
            role: 'world',
            ontologyIds: ['o1'],
            objectTypes: ['ot.order', 'ot.secret'],
            linkTypes: ['lt.x'],
            actions: ['approve'],
            operations: ['read', 'modify'],
          },
        ],
      },
      { catalog },
    );
    const reqs = [
      {
        principal: 'alice',
        resource: ResourceIds.objectType('o1', 'ot.order'),
        operation: 'read' as const,
      },
      {
        principal: 'alice',
        resource: ResourceIds.objectType('o1', 'ot.secret'),
        operation: 'modify' as const,
      },
      {
        principal: 'alice',
        resource: ResourceIds.action('o1', 'approve'),
        operation: 'modify' as const,
      },
      {
        principal: 'alice',
        resource: ResourceIds.linkType('o1', 'lt.x'),
        operation: 'read' as const,
      },
    ];
    for (const req of reqs) {
      expect(wild.authorize(req).decision).toBe(explicit.authorize(req).decision);
    }
  });

  it('wildcard does not authorize ObjectTypes absent from the catalog (not overlay eval)', () => {
    const policy = createAllowAllTestPolicy();
    expect(
      policy.authorize({
        principal: 'anyone',
        resource: ResourceIds.objectType(KERNEL_ONTOLOGY, 'ot.unknown'),
        operation: 'read',
      }).decision,
    ).toBe('deny');
    expect(
      policy.authorize({
        principal: 'anyone',
        resource: ResourceIds.admin('render'),
        operation: 'read',
      }).decision,
    ).toBe('allow');
  });

  it('new ObjectType is authorized only after a new generation', () => {
    const policy = createPolicyRuntimeFromOverlay(ALLOW_ALL_POLICY_OVERLAY, {
      catalog: emptyCatalog(),
    });
    const gen0 = policy.generation();
    const req = {
      principal: 'x',
      resource: ResourceIds.objectType('o1', 'ot.new'),
      operation: 'read' as const,
    };
    expect(policy.authorize(req).decision).toBe('deny');
    policy.recompileCatalog({
      ...emptyCatalog(),
      ontologies: ['o1'],
      objectTypes: [{ ontologyId: 'o1', id: 'ot.new' }],
    });
    expect(policy.generation()).toBeGreaterThan(gen0);
    expect(policy.authorize(req).decision).toBe('allow');
  });

  it('persist/compile failure keeps the previous generation', async () => {
    const store = createMemoryPolicyStore();
    const first = await createPolicyRuntime({
      store,
      overlay: DENY_ALL_POLICY_OVERLAY,
      persistOverlayIfEmpty: true,
    });
    const gen = first.policy.generation();
    const broken = {
      ...store,
      async replaceSnapshot() {
        throw new Error('catalog disk full');
      },
    };
    const again = await createPolicyRuntime({ store: broken });
    await expect(again.admin.publishCatalog(sampleCatalog())).rejects.toThrow(/disk full/);
    expect(again.policy.generation()).toBe(gen);
    expect(
      again.policy.authorize({
        principal: 'a',
        resource: ResourceIds.objectType('o1', 'ot.order'),
        operation: 'read',
      }).decision,
    ).toBe('deny');
    await first.policy.close();
    await again.policy.close();
  });

  it('compiled nodes are EPID rows; runtime source does not call evaluateOverlay', () => {
    const compiled = compileOverlayToEpid(ALLOW_ALL_POLICY_OVERLAY, sampleCatalog());
    expect(compiled.nodes.length).toBeGreaterThan(0);
    expect(compiled.nodes.every((n) => n.epid && n.resourceId.includes('@'))).toBe(true);
    const runtimeSrc = readFileSync(join(here, '../src/core/policy-runtime.ts'), 'utf8');
    expect(runtimeSrc).not.toContain('evaluateOverlay');
    const overlaySrc = readFileSync(join(here, '../src/core/policy-overlay.ts'), 'utf8');
    expect(overlaySrc).not.toContain('evaluateOverlay');
  });

  it('parsePolicyCatalog drops invalid rows fail-closed', () => {
    expect(parsePolicyCatalog(null).approverPolicies).toEqual([]);
    expect(parsePolicyCatalog('nope').objectTypes).toEqual([]);
    const cat = parsePolicyCatalog({
      ontologies: ['o1', 2],
      objectTypes: [null, { ontologyId: 'o1' }, { ontologyId: 'o1', id: 'ot.x' }],
      linkTypes: [{ ontologyId: 'o1', id: 'lt.x' }, 'bad'],
      actions: [{ ontologyId: 'o1', apiName: 'do' }, { ontologyId: 'o1' }],
      functions: [{ ontologyId: 'o1', id: 'fn.x' }, 3],
      admin: ['render', 1],
      approverPolicies: [null, { ontologyId: 1, id: 'm' }, { ontologyId: 'o1', id: 'manager' }],
    });
    expect(cat.ontologies).toEqual(['o1']);
    expect(cat.objectTypes).toEqual([{ ontologyId: 'o1', id: 'ot.x' }]);
    expect(cat.linkTypes).toEqual([{ ontologyId: 'o1', id: 'lt.x' }]);
    expect(cat.actions).toEqual([{ ontologyId: 'o1', apiName: 'do' }]);
    expect(cat.functions).toEqual([{ ontologyId: 'o1', id: 'fn.x' }]);
    expect(cat.admin).toEqual(['render']);
    expect(cat.approverPolicies).toEqual([{ ontologyId: 'o1', id: 'manager' }]);
  });

  it('catalogFromOntology copies types and approverPolicy names; missing version is skipped', async () => {
    const ontology = {
      async listOntologies() {
        return [
          { id: 'o1', name: 'one', createdAt: 't' },
          { id: 'empty', name: 'empty', createdAt: 't' },
        ];
      },
      async getLatestVersion(id: string) {
        if (id === 'empty') return undefined;
        return {
          objectTypes: { 'ot.x': { id: 'ot.x', displayName: 'X', propertyTypeIds: [] } },
          linkTypes: {
            'lt.x': {
              id: 'lt.x',
              displayName: 'L',
              sourceObjectTypeId: 'ot.x',
              targetObjectTypeId: 'ot.x',
            },
          },
          actionTypes: {
            a: {
              id: 'a',
              apiName: 'do',
              displayName: 'Do',
              inputObjectTypeIds: [],
              approvals: { required: true, approverPolicy: 'manager' },
            },
          },
          functionTypes: { f: { id: 'f', apiName: 'fn', displayName: 'Fn' } },
        };
      },
    };
    const cat = await catalogFromOntology(ontology as never);
    expect(cat.ontologies).toEqual(['o1', 'empty']);
    expect(cat.objectTypes).toEqual([{ ontologyId: 'o1', id: 'ot.x' }]);
    expect(cat.linkTypes).toEqual([{ ontologyId: 'o1', id: 'lt.x' }]);
    expect(cat.actions).toEqual([{ ontologyId: 'o1', apiName: 'do' }]);
    expect(cat.functions).toEqual([{ ontologyId: 'o1', id: 'fn' }]);
    expect(cat.approverPolicies).toEqual([{ ontologyId: 'o1', id: 'manager' }]);
  });

  it('approverPolicies * expands only inside selected ontologies; actions * does not grant admin', () => {
    const catalog: PolicyResourceCatalog = {
      ontologies: ['sales', 'hr'],
      objectTypes: [],
      linkTypes: [],
      actions: [
        { ontologyId: 'sales', apiName: 'discount' },
        { ontologyId: 'hr', apiName: 'hire' },
      ],
      functions: [{ ontologyId: 'sales', id: 'fn.x' }],
      admin: ['render'],
      approverPolicies: [
        { ontologyId: 'sales', id: 'manager' },
        { ontologyId: 'hr', id: 'manager' },
      ],
    };
    const policy = createPolicyRuntimeFromOverlay(
      {
        roles: { alice: ['ops'] },
        grants: [
          {
            role: 'ops',
            ontologyIds: ['sales'],
            actions: ['*'],
            approverPolicies: ['*'],
          },
        ],
      },
      { catalog },
    );
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.action('sales', 'discount'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.action('hr', 'hire'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.approver('sales', 'manager'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.approver('hr', 'manager'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.function('sales', 'fn.x'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.admin('render'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
  });

  it('adminResources ontology.write covers selected ontologies only', () => {
    const catalog: PolicyResourceCatalog = {
      ...emptyCatalog(),
      ontologies: ['sales', 'hr'],
    };
    const policy = createPolicyRuntimeFromOverlay(
      {
        roles: { alice: ['ops'] },
        grants: [{ role: 'ops', ontologyIds: ['sales'], adminResources: ['ontology.write'] }],
      },
      { catalog },
    );
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.ontology('sales'),
        operation: 'modify',
      }).decision,
    ).toBe('allow');
    expect(
      policy.authorize({
        principal: 'alice',
        resource: ResourceIds.ontology('hr'),
        operation: 'modify',
      }).decision,
    ).toBe('deny');
  });
});
