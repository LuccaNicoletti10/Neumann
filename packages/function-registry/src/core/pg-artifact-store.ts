import type { FunctionArtifact, FunctionArtifactStore, SqlClient } from 'contracts';
import type { Clock } from 'object-platform';

import { artifactSource, hashArtifactBytes } from './artifact-hash.js';
import { assertPublishableArtifact } from './artifact-scan.js';
import { FunctionArtifactHashMismatchError } from './errors.js';

function rowToArtifact(row: Record<string, unknown>): FunctionArtifact {
  const raw = row.bytes;
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : Buffer.isBuffer(raw)
        ? new Uint8Array(raw)
        : new Uint8Array(Buffer.from(String(raw), 'base64'));
  return {
    artifactHash: String(row.artifact_hash),
    bytes,
    createdAt: new Date(String(row.created_at)).toISOString(),
    createdBy: String(row.created_by),
  };
}

export function createPgFunctionArtifactStore(opts: {
  sql: SqlClient;
  clock: Clock;
}): FunctionArtifactStore {
  return {
    async publish(bytes, createdBy) {
      const source = artifactSource(bytes);
      assertPublishableArtifact(source);
      const artifactHash = hashArtifactBytes(bytes);
      const existing = await opts.sql.query<Record<string, unknown>>(
        `SELECT artifact_hash, bytes, created_at, created_by
         FROM function_artifacts WHERE artifact_hash = $1`,
        [artifactHash],
      );
      const row = existing.rows[0];
      if (row) {
        const artifact = rowToArtifact(row);
        if (hashArtifactBytes(artifact.bytes) !== artifactHash) {
          throw new FunctionArtifactHashMismatchError();
        }
        return artifact;
      }
      const createdAt = opts.clock();
      await opts.sql.query(
        `INSERT INTO function_artifacts (artifact_hash, bytes, byte_length, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (artifact_hash) DO NOTHING`,
        [artifactHash, Buffer.from(bytes), bytes.byteLength, createdAt, createdBy],
      );
      return this.get(artifactHash);
    },
    async get(artifactHash) {
      const found = await opts.sql.query<Record<string, unknown>>(
        `SELECT artifact_hash, bytes, created_at, created_by
         FROM function_artifacts WHERE artifact_hash = $1`,
        [artifactHash],
      );
      const row = found.rows[0];
      if (!row) throw new FunctionArtifactHashMismatchError();
      const artifact = rowToArtifact(row);
      if (hashArtifactBytes(artifact.bytes) !== artifact.artifactHash) {
        throw new FunctionArtifactHashMismatchError();
      }
      return artifact;
    },
  };
}
