/**
 * ingestion-runtime — durable MappingVersionRepository (memory).
 * Published rows are immutable. Identical content hash returns the existing version.
 */

import type {
  MappingVersion,
  MappingVersionRepository,
  PublishMappingInput,
} from 'contracts';
import { hashCanonical } from 'object-platform';

import { IngestionVersionConflictError } from './errors.js';

function contentOf(input: PublishMappingInput) {
  return {
    datasetId: input.datasetId,
    ontologyVersionId: input.ontologyVersionId,
    objectTypeId: input.objectTypeId,
    primaryKeyFields: input.primaryKeyFields,
    propertyMappings: input.propertyMappings,
    linkMappings: input.linkMappings ?? [],
  };
}

function toVersion(
  id: string,
  input: PublishMappingInput,
  versionNumber: number,
  contentHash: string,
  parentVersionId: string | undefined,
  publishedAt: string,
): MappingVersion {
  return {
    id,
    mappingId: input.mappingId,
    versionNumber,
    parentVersionId,
    createdAt: publishedAt,
    createdBy: input.createdBy,
    contentHash,
    status: 'COMMITTED',
    datasetId: input.datasetId,
    ontologyVersionId: input.ontologyVersionId,
    objectTypeId: input.objectTypeId,
    primaryKeyFields: [...input.primaryKeyFields],
    propertyMappings: input.propertyMappings.map((p) => ({ ...p })),
    linkMappings: (input.linkMappings ?? []).map((l) => ({ ...l })),
  };
}

export function createMemoryMappingVersionRepository(opts: {
  clock: () => string;
  nextId: (prefix: string) => string;
}): MappingVersionRepository & {
  ontologyIdOf(versionId: string): string | undefined;
} {
  const byId = new Map<string, MappingVersion>();
  const ontologyById = new Map<string, string>();
  const idsByMapping = new Map<string, string[]>();
  const hashByMapping = new Map<string, Map<string, string>>();

  return {
    ontologyIdOf(versionId) {
      return ontologyById.get(versionId);
    },
    async getVersion(id) {
      const row = byId.get(id);
      return row ? { ...row } : undefined;
    },
    async getLatest(mappingId) {
      const ids = idsByMapping.get(mappingId);
      if (!ids || ids.length === 0) return undefined;
      const last = ids[ids.length - 1];
      const row = last ? byId.get(last) : undefined;
      return row ? { ...row } : undefined;
    },
    async publish(input) {
      const content = contentOf(input);
      const hash = hashCanonical(content);
      const existingHash = hashByMapping.get(input.mappingId)?.get(hash);
      if (existingHash) {
        const found = byId.get(existingHash);
        if (found) return { ...found };
      }
      const ids = idsByMapping.get(input.mappingId) ?? [];
      const parent = ids.length ? ids[ids.length - 1] : undefined;
      const versionNumber = ids.length + 1;
      const id = opts.nextId('mapv');
      if (ids.some((vid) => byId.get(vid)?.versionNumber === versionNumber)) {
        throw new IngestionVersionConflictError(
          `mapping version CAS conflict for ${input.mappingId}`,
        );
      }
      const publishedAt = opts.clock();
      const version = toVersion(id, input, versionNumber, hash, parent, publishedAt);
      byId.set(id, version);
      ontologyById.set(id, input.ontologyId);
      ids.push(id);
      idsByMapping.set(input.mappingId, ids);
      const hashes = hashByMapping.get(input.mappingId) ?? new Map();
      hashes.set(hash, id);
      hashByMapping.set(input.mappingId, hashes);
      return { ...version };
    },
  };
}
