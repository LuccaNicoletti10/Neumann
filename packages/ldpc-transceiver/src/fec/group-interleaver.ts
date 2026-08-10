/**
 * ldpc-transceiver - src/fec/group-interleaver.ts
 *
 * Interleaver de grupos ("group interleaver" / "group-wise interleaver" da
 * familia CA3111603). Divide o codeword em Ngroup grupos de tamanho fixo
 * (preset 360 bits, como DVB-T2) e rearranja a ordem dos grupos:
 *
 *   Y_j = X_{pi(j)}   para j = 0..Ngroup-1
 *
 * onde pi e' uma permutacao deterministica (preset gerado por sequencia
 * documentada baseada em xorshift com Fisher-Yates, ou custom via array).
 * Inverso exato implementado (deinterleaver do receptor).
 */

import { Xorshift32 } from "../utils/prng.js";

/** Tamanho de grupo padrao (bits), conforme DVB-T2. */
export const DEFAULT_GROUP_SIZE = 360;

export interface GroupInterleaverConfig {
  /** Tamanho de cada grupo em bits (default 360). */
  groupSize?: number;
  /**
   * Permutacao custom: pi[j] = indice do grupo de origem do grupo de saida j.
   * Se omitida, usa o preset deterministico {@link defaultPermutation}.
   */
  permutation?: number[];
  /** Seed para o preset deterministico (default 0x360). */
  seed?: number;
}

/**
 * Gera a permutacao preset de forma deterministica:
 * Fisher-Yates sobre [0..Ngroup) usando xorshift32 com a seed fornecida.
 * Documentado: pi[j] = elemento na posicao j apos o embaralhamento.
 */
export function defaultPermutation(numGroups: number, seed = 0x360): number[] {
  const pi = Array.from({ length: numGroups }, (_, i) => i);
  const rng = new Xorshift32(seed);
  for (let j = numGroups - 1; j > 0; j--) {
    const k = rng.nextInt(j + 1);
    const tmp = pi[j]!;
    pi[j] = pi[k]!;
    pi[k] = tmp;
  }
  return pi;
}

/** Valida se arr e' uma permutacao de 0..n-1. */
export function isPermutation(arr: number[]): boolean {
  const seen = new Uint8Array(arr.length);
  for (const v of arr) {
    if (!Number.isInteger(v) || v < 0 || v >= arr.length || seen[v]) return false;
    seen[v] = 1;
  }
  return true;
}

/** Interleaver de grupos com apply/inverse exatos. */
export class GroupInterleaver {
  readonly groupSize: number;
  /** pi[j] = grupo de origem que vai para a posicao j. */
  readonly permutation: number[];

  constructor(cfg: GroupInterleaverConfig = {}, numGroupsHint?: number) {
    this.groupSize = cfg.groupSize ?? DEFAULT_GROUP_SIZE;
    if (this.groupSize <= 0) throw new Error("group-interleaver: groupSize deve ser > 0");
    if (cfg.permutation) {
      if (!isPermutation(cfg.permutation)) {
        throw new Error("group-interleaver: permutacao custom invalida");
      }
      this.permutation = [...cfg.permutation];
    } else {
      if (numGroupsHint === undefined) {
        throw new Error("group-interleaver: informe numGroupsHint ou permutation");
      }
      this.permutation = defaultPermutation(numGroupsHint, cfg.seed);
    }
  }

  /** Numero de grupos cobertos pela permutacao. */
  get numGroups(): number {
    return this.permutation.length;
  }

  /**
   * Aplica o interleaver: Y_j = X_pi(j) (grupos inteiros, ordem interna
   * dos bits preservada). Se o comprimento nao for multiplo de groupSize,
   * o ultimo grupo e' residual (menor) - os grupos preservam seus tamanhos
   * ao serem movidos. Requer bits.length <= numGroups * groupSize e
   * ceil(bits.length / groupSize) === numGroups.
   */
  apply(bits: ArrayLike<number>): number[] {
    const { offsets, sizes } = this.layout(bits.length, "group-interleaver");
    const out = new Array<number>(bits.length);
    for (let j = 0; j < sizes.length; j++) {
      const src = this.permutation[j]!;
      for (let b = 0; b < sizes[src]!; b++) {
        out[offsets[j]! + b] = bits[offsets[src]! + b]!;
      }
    }
    return out;
  }

  /** Inverso exato: X_pi(j) = Y_j, i.e., X_g = Y_{pi^-1(g)}. */
  inverse(bits: ArrayLike<number>): number[] {
    const { offsets, sizes } = this.layout(bits.length, "group-deinterleaver");
    const out = new Array<number>(bits.length);
    for (let j = 0; j < sizes.length; j++) {
      const src = this.permutation[j]!;
      for (let b = 0; b < sizes[src]!; b++) {
        out[offsets[src]! + b] = bits[offsets[j]! + b]!;
      }
    }
    return out;
  }

  /** Calcula offsets/tamanhos dos grupos para um vetor de `len` bits. */
  private layout(len: number, who: string): { offsets: number[]; sizes: number[] } {
    const G = this.numGroups;
    const S = this.groupSize;
    if (len <= 0 || Math.ceil(len / S) !== G) {
      throw new Error(
        `${who}: comprimento ${len} incompativel com ${G} grupos de ate ${S} bits`,
      );
    }
    const offsets: number[] = [];
    const sizes: number[] = [];
    let acc = 0;
    for (let g = 0; g < G; g++) {
      offsets.push(acc);
      const sz = Math.min(S, len - acc);
      sizes.push(sz);
      acc += sz;
    }
    // Grupos movidos devem preservar o tamanho: como so' o ultimo grupo pode
    // ser residual, exigimos que a permutacao nao mova grupos de tamanhos
    // distintos entre si (na pratica: pi[last] === last quando ha' residuo).
    for (let j = 0; j < G; j++) {
      if (sizes[this.permutation[j]!] !== sizes[j]) {
        throw new Error(
          `${who}: permutacao incompativel com grupo residual (pi[${j}]=${this.permutation[j]!} ` +
            `troca tamanhos ${sizes[j]}<->${sizes[this.permutation[j]!]})`,
        );
      }
    }
    return { offsets, sizes };
  }
}
