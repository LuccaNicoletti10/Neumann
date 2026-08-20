/**
 * Recompile policy catalog after ontology publish.
 *
 * WHY: overlay `*` expands only against known resources; a new ObjectType
 * must not be authorized on the previous generation.
 */

import type { OntologyRegistry } from 'contracts';
import { catalogFromOntology, type PolicyAdmin, type PolicyRuntime } from 'policy-engine';

export function wrapOntologyWithPolicyCatalog(
  ontology: OntologyRegistry,
  sync: () => void | Promise<void>,
): OntologyRegistry {
  const after = async <T>(fn: () => Promise<T>): Promise<T> => {
    const result = await fn();
    await sync();
    return result;
  };
  return {
    createOntology: (input) => after(() => ontology.createOntology(input)),
    getOntology: (id) => ontology.getOntology(id),
    listOntologies: () => ontology.listOntologies(),
    openDraft: (id) => ontology.openDraft(id),
    getDraft: (id) => ontology.getDraft(id),
    addPropertyType: (id, def) => ontology.addPropertyType(id, def),
    addObjectType: (id, def) => ontology.addObjectType(id, def),
    addLinkType: (id, def) => ontology.addLinkType(id, def),
    addActionType: (id, def) => ontology.addActionType(id, def),
    addFunctionType: (id, def) => ontology.addFunctionType(id, def),
    commit: (input) => after(() => ontology.commit(input)),
    getVersion: (id) => ontology.getVersion(id),
    getLatestVersion: (id) => ontology.getLatestVersion(id),
    listVersions: (id) => ontology.listVersions(id),
    rollback: (ontologyId, target, createdBy) =>
      after(() => ontology.rollback(ontologyId, target, createdBy)),
    diff: (a, b) => ontology.diff(a, b),
  };
}

export async function syncPolicyCatalog(
  ontology: OntologyRegistry,
  policy: PolicyRuntime,
  admin?: PolicyAdmin,
): Promise<void> {
  const catalog = await catalogFromOntology(ontology);
  if (admin) {
    await admin.publishCatalog(catalog);
    return;
  }
  policy.recompileCatalog(catalog);
}
