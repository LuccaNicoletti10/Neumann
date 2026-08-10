/**
 * ldpc-transceiver - src/utils/bits.ts
 *
 * Utilitarios de conversao bits <-> bytes <-> hex (MSB-first).
 * Suporte a cadeia TX/RX da familia CA3111603 (interface de dados).
 */

/** Converte bytes em bits (MSB-first). */
export function bytesToBits(bytes: Uint8Array): number[] {
  const out = new Array<number>(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    for (let j = 0; j < 8; j++) out[i * 8 + j] = (b >>> (7 - j)) & 1;
  }
  return out;
}

/** Converte bits (MSB-first) em bytes; o comprimento deve ser multiplo de 8. */
export function bitsToBytes(bits: ArrayLike<number>): Uint8Array {
  if (bits.length % 8 !== 0) {
    throw new Error(`bitsToBytes: ${bits.length} bits nao e' multiplo de 8`);
  }
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i * 8 + j]! & 1);
    out[i] = b;
  }
  return out;
}

/** Hex string -> bits. */
export function hexToBits(hex: string): number[] {
  const clean = hex.replace(/\s+/g, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("hexToBits: string hex invalida");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytesToBits(bytes);
}

/** Bits -> hex string (comprimento deve ser multiplo de 8). */
export function bitsToHex(bits: ArrayLike<number>): string {
  return Buffer.from(bitsToBytes(bits)).toString("hex");
}

/** Gera bits pseudo-aleatorios deterministicos a partir de um PRNG. */
export function randomBits(n: number, rng: { nextBit(): 0 | 1 }): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = rng.nextBit();
  return out;
}

/** Conta bits diferentes entre dois vetores. */
export function countBitErrors(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let errors = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if ((a[i]! & 1) !== (b[i]! & 1)) errors++;
  return errors;
}
