/**
 * ActionType loader. Ontology versions are the only source.
 *
 * WHY pin by version id + hash: "latest" after pause would apply a definition
 * that the requester never submitted.
 */

import type {
  ActionDefinitionResolver,
  ActionTypeDef,
  ActionTypeId,
  OntologyId,
  OntologyRegistry,
  OntologyVersionId,
  ResolvedActionDefinition,
} from 'contracts';
import { hashCanonical } from 'object-platform';

function apiNameOf(def: ActionTypeDef): string {
  return def.apiName ?? def.id;
}

function freezeDef(def: ActionTypeDef): ActionTypeDef {
  return Object.freeze(structuredClone(def));
}

function toResolved(
  ontologyId: OntologyId,
  ontologyVersionId: OntologyVersionId,
  def: ActionTypeDef,
): ResolvedActionDefinition {
  const frozen = freezeDef(def);
  return {
    ontologyId,
    ontologyVersionId,
    actionTypeId: frozen.id,
    apiName: apiNameOf(frozen),
    hash: hashCanonical(frozen),
    def: frozen,
  };
}

/**
 * Resolver backed by OntologyRegistry.getVersion.
 * @throws if the version is missing, belongs to another ontology, or the type is absent.
 */
export function createOntologyActionResolver(
  registry: OntologyRegistry,
): ActionDefinitionResolver {
  return {
    async resolve(ontologyId, ontologyVersionId, actionTypeId) {
      const version = await registry.getVersion(ontologyVersionId);
      if (!version || version.ontologyId !== ontologyId) {
        throw new Error(`pinned ontology version not found: ${ontologyVersionId}`);
      }
      const def = version.actionTypes[actionTypeId];
      if (!def) {
        throw new Error(
          `pinned ActionType ${actionTypeId} not in version ${ontologyVersionId}`,
        );
      }
      return toResolved(ontologyId, ontologyVersionId, def);
    },
  };
}

function findByApiName(
  actionTypes: Record<ActionTypeId, ActionTypeDef>,
  apiName: string,
): ActionTypeDef | undefined {
  return Object.values(actionTypes).find(
    (d) => apiNameOf(d) === apiName || d.id === apiName,
  );
}

/**
 * Resolve by API name at a specific version, or at latest when `ontologyVersionId` is omitted.
 * Returns undefined when the ontology/type is unknown (validate/apply map this to FAILED).
 */
export async function resolveActionByApiName(
  registry: OntologyRegistry,
  resolver: ActionDefinitionResolver,
  ontologyId: OntologyId,
  apiName: string,
  ontologyVersionId?: OntologyVersionId,
): Promise<ResolvedActionDefinition | undefined> {
  if (ontologyVersionId) {
    const version = await registry.getVersion(ontologyVersionId);
    if (!version || version.ontologyId !== ontologyId) return undefined;
    const def = findByApiName(version.actionTypes, apiName);
    if (!def) return undefined;
    return resolver.resolve(ontologyId, ontologyVersionId, def.id);
  }
  const latest = await registry.getLatestVersion(ontologyId);
  if (!latest) return undefined;
  const def = findByApiName(latest.actionTypes, apiName);
  if (!def) return undefined;
  return resolver.resolve(ontologyId, latest.id, def.id);
}
