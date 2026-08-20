/**
 * Commit ActionTypes on a real OntologyRegistry. Tests must not seed a parallel Map.
 */
import type { ActionTypeDef, OntologyRegistry } from 'contracts';
import { createOntologyRegistry } from 'ontology-registry';

export async function seedActionOntology(opts: {
  actions: ActionTypeDef[];
  objectTypeIds?: string[];
  ontology?: OntologyRegistry;
  clock?: () => string;
  nextId?: (prefix: string) => string;
  createdBy?: string;
}): Promise<{ ontology: OntologyRegistry; ontologyId: string; versionId: string }> {
  const clock = opts.clock ?? (() => 't');
  const nextId = opts.nextId ?? ((p: string) => `${p}-1`);
  const ontology = opts.ontology ?? createOntologyRegistry({ clock, nextId });
  const createdBy = opts.createdBy ?? 't';
  const o = await ontology.createOntology({ name: 'actions', createdBy });
  const objectTypeIds = new Set(opts.objectTypeIds ?? []);
  for (const def of opts.actions) {
    for (const id of def.inputObjectTypeIds ?? []) objectTypeIds.add(id);
  }
  if (objectTypeIds.size === 0) objectTypeIds.add('ot.order');
  for (const id of objectTypeIds) {
    await ontology.addObjectType(o.id, { id, displayName: id, propertyTypeIds: [] });
  }
  for (const def of opts.actions) {
    await ontology.addActionType(o.id, def);
  }
  const version = await ontology.commit({ ontologyId: o.id, createdBy });
  return { ontology, ontologyId: o.id, versionId: version.id };
}
