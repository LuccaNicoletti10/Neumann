/**
 * Passo 3 / SOPS+age (gestao de secrets):
 * AgeLikeCrypto — LEGACY read-only (formato `# age-like v1`).
 * @deprecated Use age-backend.ts. Remover após a release seguinte à migração.

 * par X25519 (chave publica "age1..."-like, secreta "AGE-SECRET-KEY-1..."),
 * encrypt com X25519 efemero -> ECDH -> HKDF -> ChaCha20-Poly1305, decrypt
 * correspondente. Formato textual tipo SOPS (header com destinatarios +
 * payload base64). Tamper-evident via auth tag (header entra como AAD).
 */
import {
  createCipheriv,
  createDecipheriv,
  type CipherGCM,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

const B32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'; // bech32 charset (age-like)

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toLowerCase()) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`caractere base32 invalido: '${ch}'`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export interface AgeLikeKeyPair {
  /** Chave publica "age1..."-like (32 bytes X25519 codificados). */
  publicKey: string;
  /** Chave secreta "AGE-SECRET-KEY-1..."-like (d || x, 64 bytes). */
  secretKey: string;
}

const FILE_KEY_LEN = 16;
const NONCE_LEN = 12;
const HEADER_PREFIX = '# age-like v1';
const RECIPIENT_PREFIX = '# recipient: ';

function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') }, format: 'jwk' });
}

function privateKeyFromRaw(d: Buffer, x: Buffer): KeyObject {
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'X25519', d: d.toString('base64url'), x: x.toString('base64url') },
    format: 'jwk',
  });
}

function rawPublic(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' }) as { x?: string };
  if (!jwk.x) throw new Error('chave sem componente publico x');
  return Buffer.from(jwk.x, 'base64url');
}

export class AgeLikeCrypto {
  /** Gera um novo par X25519 com codificacao age-like. */
  static generateKeyPair(): AgeLikeKeyPair {
    const { publicKey: _publicKey, privateKey } = generateKeyPairSync('x25519');
    const privJwk = privateKey.export({ format: 'jwk' }) as { d?: string; x?: string };
    if (!privJwk.d || !privJwk.x) throw new Error('falha ao exportar par X25519');
    const d = Buffer.from(privJwk.d, 'base64url');
    const x = Buffer.from(privJwk.x, 'base64url');
    return {
      publicKey: 'age1' + base32Encode(x),
      secretKey: 'AGE-SECRET-KEY-1' + base32Encode(Buffer.concat([d, x])).toUpperCase(),
    };
  }

  /** Deriva a chave publica a partir da secreta. */
  static publicKeyFromSecret(secretKey: string): string {
    const { x } = AgeLikeCrypto.parseSecret(secretKey);
    return 'age1' + base32Encode(x);
  }

  private static parsePublic(publicKey: string): Buffer {
    if (!publicKey.startsWith('age1')) throw new Error('chave publica age-like invalida');
    const raw = base32Decode(publicKey.slice(4));
    if (raw.length !== 32) throw new Error('chave publica age-like com tamanho invalido');
    return raw;
  }

  private static parseSecret(secretKey: string): { d: Buffer; x: Buffer } {
    if (!secretKey.toUpperCase().startsWith('AGE-SECRET-KEY-1')) {
      throw new Error('chave secreta age-like invalida');
    }
    const raw = base32Decode(secretKey.slice('AGE-SECRET-KEY-1'.length));
    if (raw.length !== 64) throw new Error('chave secreta age-like com tamanho invalido');
    return { d: raw.subarray(0, 32), x: raw.subarray(32, 64) };
  }

  /**
   * Cifra `plaintext` para um ou mais destinatarios (chaves publicas age1...).
   * Retorna o arquivo textual: header com stanzas de destinatario + payload
   * base64. O header e autenticado (AAD), logo qualquer adulteracao e
   * detectada no decrypt.
   */
  static encrypt(plaintext: Buffer | string, recipients: string[]): string {
    if (recipients.length === 0) throw new Error('ao menos um destinatario e necessario');
    const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
    const fileKey = randomBytes(FILE_KEY_LEN);

    const stanzas: string[] = [];
    for (const recipient of recipients) {
      const recipPubRaw = AgeLikeCrypto.parsePublic(recipient);
      const recipPub = publicKeyFromRaw(recipPubRaw);
      const eph = generateKeyPairSync('x25519');
      const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipPub });
      const ephPubRaw = rawPublic(eph.publicKey);
      const wrapKey = Buffer.from(
        hkdfSync('sha256', shared, Buffer.concat([ephPubRaw, recipPubRaw]), 'age-like-wrap', 32),
      );
      const nonce = randomBytes(NONCE_LEN);
      const cipher = createCipheriv('chacha20-poly1305', wrapKey, nonce, { authTagLength: 16 });
      const wrapped = Buffer.concat([cipher.update(fileKey), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Stanza: ephPub(32) || nonce(12) || tag(16) || wrappedFileKey(16)
      stanzas.push(Buffer.concat([ephPubRaw, nonce, tag, wrapped]).toString('base64'));
    }

    const headerLines = [HEADER_PREFIX, ...stanzas.map((s) => RECIPIENT_PREFIX + s)];
    const header = headerLines.join('\n') + '\n';

    const payloadNonce = randomBytes(NONCE_LEN);
    const cipher = createCipheriv('chacha20-poly1305', hkdfPayloadKey(fileKey), payloadNonce, {
      authTagLength: 16,
    }) as CipherGCM;
    cipher.setAAD(Buffer.from(header, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const payload = Buffer.concat([payloadNonce, cipher.getAuthTag(), ciphertext]);

    return header + payload.toString('base64') + '\n';
  }

  /**
   * Decifra um arquivo textual age-like com a chave secreta do destinatario.
   * Lanca erro se a chave nao servir ou se o arquivo tiver sido adulterado.
   */
  static decrypt(fileText: string, secretKey: string): Buffer {
    const lines = fileText.split('\n').filter((l) => l.trim() !== '');
    if (lines[0] !== HEADER_PREFIX) throw new Error('arquivo age-like invalido (header ausente)');
    const stanzas: Buffer[] = [];
    let payloadLine: string | null = null;
    for (const line of lines.slice(1)) {
      if (line.startsWith(RECIPIENT_PREFIX)) stanzas.push(Buffer.from(line.slice(RECIPIENT_PREFIX.length), 'base64'));
      else if (!line.startsWith('#')) payloadLine = line;
    }
    if (!payloadLine) throw new Error('payload ausente no arquivo age-like');
    const payload = Buffer.from(payloadLine, 'base64');
    if (payload.length < NONCE_LEN + 16) throw new Error('payload corrompido');

    const { d, x } = AgeLikeCrypto.parseSecret(secretKey);
    const myPriv = privateKeyFromRaw(d, x);
    const myPubRaw = x;

    let fileKey: Buffer | null = null;
    for (const stanza of stanzas) {
      if (stanza.length !== 32 + NONCE_LEN + 16 + FILE_KEY_LEN) continue;
      const ephPubRaw = stanza.subarray(0, 32);
      const nonce = stanza.subarray(32, 32 + NONCE_LEN);
      const tag = stanza.subarray(32 + NONCE_LEN, 32 + NONCE_LEN + 16);
      const wrapped = stanza.subarray(32 + NONCE_LEN + 16);
      try {
        const shared = diffieHellman({ privateKey: myPriv, publicKey: publicKeyFromRaw(ephPubRaw) });
        const wrapKey = Buffer.from(
          hkdfSync('sha256', shared, Buffer.concat([ephPubRaw, myPubRaw]), 'age-like-wrap', 32),
        );
        const decipher = createDecipheriv('chacha20-poly1305', wrapKey, nonce, { authTagLength: 16 });
        decipher.setAuthTag(tag);
        fileKey = Buffer.concat([decipher.update(wrapped), decipher.final()]);
        break;
      } catch {
        // Stanza nao e para esta chave; tenta a proxima.
      }
    }
    if (!fileKey) throw new Error('nenhuma stanza corresponde a chave secreta informada');

    const header = lines
      .slice(0, lines.indexOf(payloadLine))
      .join('\n') + '\n';
    const nonce = payload.subarray(0, NONCE_LEN);
    const tag = payload.subarray(NONCE_LEN, NONCE_LEN + 16);
    const ciphertext = payload.subarray(NONCE_LEN + 16);
    const decipher = createDecipheriv('chacha20-poly1305', hkdfPayloadKey(fileKey), nonce, {
      authTagLength: 16,
    });
    decipher.setAuthTag(tag);
    // Os tipos exigem plaintextLength (ignorado em runtime p/ chacha20).
    decipher.setAAD(Buffer.from(header, 'utf8'), { plaintextLength: ciphertext.length });
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error('falha de autenticacao: arquivo adulterado ou chave incorreta');
    }
  }
}

function hkdfPayloadKey(fileKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', fileKey, Buffer.alloc(0), 'age-like-payload', 32));
}