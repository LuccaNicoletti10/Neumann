import type { FunctionArtifact, FunctionArtifactStore } from 'contracts';
import type { Clock } from 'object-platform';

import { artifactSource, hashArtifactBytes } from './artifact-hash.js';
import { assertPublishableArtifact } from './artifact-scan.js';
import { FunctionArtifactHashMismatchError } from './errors.js';

export function createMemoryFunctionArtifactStore(opts: { clock: Clock }): FunctionArtifactStore {
  const byHash = new Map<string, FunctionArtifact>();
  return {
    async publish(bytes, createdBy) {
      const source = artifactSource(bytes);
      assertPublishableArtifact(source);
      const artifactHash = hashArtifactBytes(bytes);
      const existing = byHash.get(artifactHash);
      if (existing) {
        const current = hashArtifactBytes(existing.bytes);
        if (current !== existing.artifactHash) throw new FunctionArtifactHashMismatchError();
        return existing;
      }
      const artifact: FunctionArtifact = {
        artifactHash,
        bytes: new Uint8Array(bytes),
        createdAt: opts.clock(),
        createdBy,
      };
      byHash.set(artifactHash, artifact);
      return artifact;
    },
    async get(artifactHash) {
      const artifact = byHash.get(artifactHash);
      if (!artifact) throw new FunctionArtifactHashMismatchError();
      if (hashArtifactBytes(artifact.bytes) !== artifact.artifactHash) {
        throw new FunctionArtifactHashMismatchError();
      }
      return { ...artifact, bytes: new Uint8Array(artifact.bytes) };
    },
  };
}
