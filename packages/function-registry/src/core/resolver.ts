import type {
  FunctionDefinitionResolver,
  FunctionTypeDef,
  OntologyRegistry,
  OntologyVersion,
} from 'contracts';

import { hashFunctionSchema } from './request-identity.js';

function functionOf(version: OntologyVersion, functionId: string): FunctionTypeDef {
  const byId = version.functionTypes[functionId];
  if (byId) return byId;
  const match = Object.values(version.functionTypes).find(
    (def) => def.apiName === functionId || def.id === functionId,
  );
  if (!match) throw new Error(`FunctionType not in ontology version: ${functionId}`);
  return match;
}

export function createFunctionDefinitionResolver(opts: {
  ontology: OntologyRegistry;
}): FunctionDefinitionResolver {
  return {
    async pin(input) {
      const version = input.ontologyVersionId
        ? await opts.ontology.getVersion(input.ontologyVersionId)
        : await opts.ontology.getLatestVersion(input.ontologyId);
      if (!version || version.ontologyId !== input.ontologyId) {
        throw new Error('ontology version not found');
      }
      const def = functionOf(version, input.functionId);
      if (!def.artifactHash) {
        throw new Error(`FunctionType ${def.id} has no artifactHash`);
      }
      return {
        ontologyId: version.ontologyId,
        ontologyVersionId: version.id,
        functionId: def.id,
        functionVersion: def.functionVersion ?? 1,
        artifactHash: def.artifactHash,
        inputSchemaHash: hashFunctionSchema(def.inputSchema),
        outputSchemaHash: hashFunctionSchema(def.outputSchema),
      };
    },
  };
}
