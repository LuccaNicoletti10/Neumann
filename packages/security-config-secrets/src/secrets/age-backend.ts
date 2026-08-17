/**
 * Adapter over the `age-encryption` library (MIT/BSD, TypeScript).
 * Payloads are native age-encryption.org/v1 (ASCII armor) — interoperable with the age CLI.
 */
import * as age from 'age-encryption';

export interface AgeKeyPair {
  publicKey: string;
  secretKey: string;
}

export interface AgeBackend {
  generateKeyPair(): Promise<AgeKeyPair>;
  publicKeyFromSecret(secretKey: string): Promise<string>;
  encrypt(plaintext: Buffer | string, recipients: string[]): Promise<string>;
  decrypt(payload: string | Uint8Array, identity: string): Promise<Buffer>;
}

function asUint8(data: Buffer | string): Uint8Array {
  return Buffer.isBuffer(data) ? new Uint8Array(data) : new TextEncoder().encode(data);
}

function decodePayload(payload: string | Uint8Array): Uint8Array {
  if (typeof payload !== 'string') return payload;
  const trimmed = payload.trim();
  if (trimmed.includes('BEGIN AGE ENCRYPTED FILE')) {
    return age.armor.decode(trimmed);
  }
  if (trimmed.startsWith('age-encryption.org/v1')) {
    return new TextEncoder().encode(trimmed);
  }
  return Buffer.from(trimmed, 'base64');
}

export const AgeBackend: AgeBackend = {
  async generateKeyPair() {
    const secretKey = await age.generateIdentity();
    const publicKey = await age.identityToRecipient(secretKey);
    return { publicKey, secretKey };
  },

  async publicKeyFromSecret(secretKey: string) {
    return age.identityToRecipient(secretKey);
  },

  async encrypt(plaintext, recipients) {
    if (recipients.length === 0) throw new Error('ao menos um destinatario e necessario');
    const encrypter = new age.Encrypter();
    for (const r of recipients) encrypter.addRecipient(r);
    const ciphertext = await encrypter.encrypt(asUint8(plaintext));
    const bytes = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext);
    return age.armor.encode(bytes);
  },

  async decrypt(payload, identity) {
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(identity);
    const plain = await decrypter.decrypt(decodePayload(payload));
    return Buffer.from(plain);
  },
};

export function isAgeV1Payload(text: string): boolean {
  const t = text.trim();
  if (t.includes('BEGIN AGE ENCRYPTED FILE')) return true;
  if (t.startsWith('age-encryption.org/v1')) return true;
  try {
    const raw = Buffer.from(t, 'base64').toString('utf8');
    return raw.startsWith('age-encryption.org/v1') || raw.includes('BEGIN AGE ENCRYPTED FILE');
  } catch {
    return false;
  }
}
