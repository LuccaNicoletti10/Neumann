/**
 * Named test fixture: EPID allow-all compiled against the actions under test.
 * Never an implicit production default.
 */
import {
  createAllowAllTestPolicy,
  type PolicyResourceCatalog,
} from 'policy-engine';

type ActionCatalogSeed = {
  id: string;
  apiName?: string;
  inputObjectTypeIds?: string[];
};

export function catalogForActionTypes(
  actionTypes: Record<string, readonly ActionCatalogSeed[]>,
): PolicyResourceCatalog {
  const cat: PolicyResourceCatalog = {
    ontologies: [],
    objectTypes: [],
    linkTypes: [],
    actions: [],
    functions: [],
    admin: [],
    approverPolicies: [],
  };
  const seenOt = new Set<string>();
  for (const [ontologyId, defs] of Object.entries(actionTypes)) {
    cat.ontologies.push(ontologyId);
    (cat.approverPolicies ??= []).push({ ontologyId, id: 'manager' });
    for (const def of defs) {
      cat.actions.push({ ontologyId, apiName: def.apiName ?? def.id });
      for (const id of def.inputObjectTypeIds ?? []) {
        const k = `${ontologyId}/${id}`;
        if (seenOt.has(k)) continue;
        seenOt.add(k);
        cat.objectTypes.push({ ontologyId, id });
      }
    }
  }
  return cat;
}

export function createAllowAllTestAuthorize(
  actionTypes: Record<string, readonly ActionCatalogSeed[]>,
) {
  return createAllowAllTestPolicy(catalogForActionTypes(actionTypes)).authorizeFn;
}

/** Catalog covering executor / durability / CLI action names. */
export const ACTION_ENGINE_TEST_CATALOG: PolicyResourceCatalog = catalogForActionTypes({
  o1: [
    { id: 'act.approve', apiName: 'approve', inputObjectTypeIds: ['ot.order'] },
    { id: 'act.create', apiName: 'createOrder', inputObjectTypeIds: ['ot.order'] },
    { id: 'act.discount', apiName: 'discount', inputObjectTypeIds: ['ot.order'] },
    { id: 'act.create2', apiName: 'create', inputObjectTypeIds: ['ot.order'] },
    { id: 'act.report', apiName: 'report', inputObjectTypeIds: ['ot.order'] },
    {
      id: 'act.approve-so',
      apiName: 'approve-sales-order',
      inputObjectTypeIds: ['ot.sales-order'],
    },
    {
      id: 'act.create-so',
      apiName: 'create-sales-order',
      inputObjectTypeIds: ['ot.sales-order'],
    },
    { id: 'act.report-so', apiName: 'order-report', inputObjectTypeIds: ['ot.sales-order'] },
    { id: 'act.boom', apiName: 'boom', inputObjectTypeIds: ['ot.order'] },
    { id: 'act.boom2', apiName: 'boom2', inputObjectTypeIds: ['ot.order'] },
    { id: 'act.create-opt', apiName: 'createOpt', inputObjectTypeIds: ['ot.order'] },
  ],
});

export const allowAllAuthorize = createAllowAllTestPolicy(ACTION_ENGINE_TEST_CATALOG).authorizeFn;
