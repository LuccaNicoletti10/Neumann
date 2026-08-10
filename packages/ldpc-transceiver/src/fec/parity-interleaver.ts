/**
 * ldpc-transceiver - src/fec/parity-interleaver.ts
 *
 * Interleaver de paridade: implementa o componente "interleaver" (e o
 * "deinterleaver" no receptor) da familia CA3111603. Interleava SOMENTE
 * os bits de paridade do codeword LDPC, mantendo os bits de informacao
 * intactos.
 *
 * Regra (grupos de Z bits sobre a paridade):
 *   paridade p (M bits) dividida em Q = floor(M / Z) grupos de Z bits
 *   (mais um grupo residual R = M mod Z, se houver).
 *   O bit i do grupo j vai para a posicao i * Q + j da paridade
 *   interleavada (rotacao/escrita por grupos, leitura transposta).
 *   O grupo residual (se existir) e' rotacionado ciclicamente de 1 posicao.
 * Inverso exato implementado por `parityDeinterleave`.
 */

export interface ParityInterleaverConfig {
  /** Numero de bits de informacao K (prefixo intocado). */
  K: number;
  /** Comprimento total do codeword N. */
  N: number;
  /** Tamanho do grupo Z (tipicamente o fator de expansao do QC-LDPC). */
  Z: number;
}

/**
 * Aplica o parity interleaver sobre um codeword [info | paridade].
 * Retorna novo array; entrada nao modificada.
 */
export function parityInterleave(codeword: ArrayLike<number>, cfg: ParityInterleaverConfig): number[] {
  const { K, N, Z } = cfg;
  validate(codeword.length, cfg);
  const M = N - K;
  const out = new Array<number>(N);
  // Informacao intocada.
  for (let i = 0; i < K; i++) out[i] = codeword[i]!;

  const Q = Math.floor(M / Z);
  const R = M % Z;
  const p = (idx: number): number => codeword[K + idx]!;

  // Transposicao por grupos: saida[i * Q + j] = paridade[j * Z + i].
  for (let j = 0; j < Q; j++) {
    for (let i = 0; i < Z; i++) {
      out[K + i * Q + j] = p(j * Z + i);
    }
  }
  // Residuo: rotacao ciclica de 1 posicao.
  for (let i = 0; i < R; i++) {
    out[K + Q * Z + ((i + 1) % R)] = p(Q * Z + i);
  }
  return out;
}

/** Inverso exato de {@link parityInterleave}. */
export function parityDeinterleave(interleaved: ArrayLike<number>, cfg: ParityInterleaverConfig): number[] {
  const { K, N, Z } = cfg;
  validate(interleaved.length, cfg);
  const M = N - K;
  const out = new Array<number>(N);
  for (let i = 0; i < K; i++) out[i] = interleaved[i]!;

  const Q = Math.floor(M / Z);
  const R = M % Z;
  const y = (idx: number): number => interleaved[K + idx]!;

  // Inverso da transposicao: paridade[j * Z + i] = entrada[i * Q + j].
  for (let j = 0; j < Q; j++) {
    for (let i = 0; i < Z; i++) {
      out[K + j * Z + i] = y(i * Q + j);
    }
  }
  // Inverso da rotacao ciclica de 1 posicao.
  for (let i = 0; i < R; i++) {
    out[K + Q * Z + i] = y(Q * Z + ((i + 1) % R));
  }
  return out;
}

/** Classe de conveniencia com apply/inverse. */
export class ParityInterleaver {
  constructor(readonly config: ParityInterleaverConfig) {}
  apply(codeword: ArrayLike<number>): number[] {
    return parityInterleave(codeword, this.config);
  }
  inverse(interleaved: ArrayLike<number>): number[] {
    return parityDeinterleave(interleaved, this.config);
  }
}

function validate(len: number, cfg: ParityInterleaverConfig): void {
  if (len !== cfg.N) {
    throw new Error(`parity-interleaver: esperado vetor de ${cfg.N} bits, recebido ${len}`);
  }
  if (cfg.K < 0 || cfg.K >= cfg.N) throw new Error("parity-interleaver: K invalido");
  if (cfg.Z <= 0) throw new Error("parity-interleaver: Z deve ser > 0");
}
