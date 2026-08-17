/**
 * @deprecated Read-only legacy AgeLikeCrypto. Use age-backend.ts (real age).
 * Kept so `secrets migrate` can decrypt historical payloads.
 */
export { AgeLikeCrypto, type AgeLikeKeyPair } from './legacy/age-crypto-legacy.js';
