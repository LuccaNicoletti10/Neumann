/**
 * ingestion-runtime — Mapping catalog port.
 * MappingVersionRepository is the durable authority (ADR-0017).
 * ObjectPlatform Maps remain a CLI/demo facade wrapped for existing tests.
 */

import type {
  MappingId,
  MappingVersion,
  MappingVersionId,
  MappingVersionRepository,
  ObjectPlatform,
} from 'contracts';

export interface MappingCatalog {
  getVersion(id: MappingVersionId): Promise<MappingVersion | undefined>;
  getLatest(mappingId: MappingId): Promise<MappingVersion | undefined>;
}

export function catalogFromPlatform(
  platform: Pick<ObjectPlatform, 'getMappingVersion' | 'getLatestMappingVersion'>,
): MappingCatalog {
  return {
    getVersion: async (id) => platform.getMappingVersion(id),
    getLatest: async (id) => platform.getLatestMappingVersion(id),
  };
}

export function catalogFromRepository(
  repo: Pick<MappingVersionRepository, 'getVersion' | 'getLatest'>,
): MappingCatalog {
  return {
    getVersion: (id) => repo.getVersion(id),
    getLatest: (id) => repo.getLatest(id),
  };
}

export function createMemoryMappingCatalog(
  versions: readonly MappingVersion[] = [],
): MappingCatalog & { put(version: MappingVersion): void } {
  const byId = new Map<string, MappingVersion>();
  const latest = new Map<string, MappingVersion>();
  function put(version: MappingVersion): void {
    byId.set(version.id, version);
    const current = latest.get(version.mappingId);
    if (!current || version.versionNumber >= current.versionNumber) {
      latest.set(version.mappingId, version);
    }
  }
  for (const v of versions) put(v);
  return {
    getVersion: async (id) => byId.get(id),
    getLatest: async (id) => latest.get(id),
    put,
  };
}
