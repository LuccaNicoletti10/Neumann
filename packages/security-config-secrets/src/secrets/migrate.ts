/**
 * Migrates `# age-like v1` files to native age-encryption.org/v1.
 * Atomic: write tmp + rename. Corrupted payloads throw without touching the original.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AgeBackend, isAgeV1Payload } from './age-backend.js';
import { AgeLikeCrypto } from './legacy/age-crypto-legacy.js';

export interface MigrateSecretsOptions {
  filePath: string;
  legacySecretKey: string;
  identity: string;
  recipients?: string[];
}

export async function migrateSecretsFile(opts: MigrateSecretsOptions): Promise<'migrated' | 'already-age'> {
  if (!existsSync(opts.filePath)) throw new Error(`arquivo inexistente: ${opts.filePath}`);
  const original = readFileSync(opts.filePath, 'utf8');
  if (isAgeV1Payload(original) && !original.includes('# age-like v1')) {
    return 'already-age';
  }
  let plain: Buffer;
  try {
    plain = AgeLikeCrypto.decrypt(original, opts.legacySecretKey);
  } catch (err) {
    throw new Error(
      `falha ao decifrar formato legado (arquivo intacto): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const recipients =
    opts.recipients && opts.recipients.length > 0
      ? opts.recipients
      : [await AgeBackend.publicKeyFromSecret(opts.identity)];
  const encrypted = await AgeBackend.encrypt(plain, recipients);
  const tmp = join(dirname(opts.filePath), `.${Date.now()}.enc.tmp`);
  writeFileSync(tmp, encrypted, 'utf8');
  renameSync(tmp, opts.filePath);
  return 'migrated';
}
