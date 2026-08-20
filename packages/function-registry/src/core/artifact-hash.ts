import { createHash } from 'node:crypto';

export function hashArtifactBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function artifactSource(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

export function artifactBytesFromSource(source: string): Uint8Array {
  return new Uint8Array(Buffer.from(source, 'utf8'));
}
