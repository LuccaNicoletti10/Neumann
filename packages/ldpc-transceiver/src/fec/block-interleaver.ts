/**
 * ldpc-transceiver - src/fec/block-interleaver.ts
 *
 * Block interleaver em duas partes (componente "block interleaver" /
 * "block deinterleaver" da familia CA3111603, no espirito do DVB-T2).
 *
 * Escrita (direcao de coluna):
 *   - Parte 1: C1 colunas x R linhas; recebe os primeiros R*C1 bits
 *     serialmente (coluna 0 de cima para baixo, depois coluna 1, ...).
 *   - Parte 2: C2 colunas; recebe os bits restantes da mesma forma
 *     (a ultima coluna pode ficar parcialmente preenchida).
 * Leitura (direcao de linha): linha 0 (parte 1 depois parte 2), linha 1, ...
 *
 * Inverso exato implementado por {@link BlockInterleaver.inverse}.
 */

export interface BlockInterleaverConfig {
  /** Numero de linhas R. */
  rows: number;
  /** Numero de colunas da parte 1 (C1). */
  colsPart1: number;
  /** Numero de colunas da parte 2 (C2). */
  colsPart2: number;
}

/** Interleaver de bloco em duas partes, com apply/inverse exatos. */
export class BlockInterleaver {
  readonly rows: number;
  readonly colsPart1: number;
  readonly colsPart2: number;
  private permCache = new Map<number, number[]>();

  constructor(cfg: BlockInterleaverConfig) {
    if (cfg.rows <= 0 || cfg.colsPart1 < 0 || cfg.colsPart2 <= 0) {
      throw new Error("block-interleaver: rows>0, colsPart2>0 e colsPart1>=0 sao obrigatorios");
    }
    this.rows = cfg.rows;
    this.colsPart1 = cfg.colsPart1;
    this.colsPart2 = cfg.colsPart2;
  }

  /**
   * Aplica o block interleaver. O comprimento deve satisfazer
   * rows*colsPart1 < len <= rows*(colsPart1+colsPart2) (a parte 2 recebe
   * ao menos 1 bit e a parte 1 fica sempre cheia; se len couber exatamente
   * na parte 1, len === rows*colsPart1 tambem e' aceito).
   */
  apply(bits: ArrayLike<number>): number[] {
    const perm = this.permutation(bits.length);
    const out = new Array<number>(bits.length);
    for (let w = 0; w < bits.length; w++) out[perm[w]!] = bits[w]!;
    return out;
  }

  /** Inverso exato de {@link apply}. */
  inverse(bits: ArrayLike<number>): number[] {
    const perm = this.permutation(bits.length);
    const out = new Array<number>(bits.length);
    for (let w = 0; w < bits.length; w++) out[w] = bits[perm[w]!]!;
    return out;
  }

  /**
   * Permutacao write->read: perm[w] = posicao de leitura do bit escrito na
   * posicao w. Computada por simulacao direta (deterministica) e cacheada
   * por comprimento.
   */
  permutation(len: number): number[] {
    const cached = this.permCache.get(len);
    if (cached) return cached;
    const R = this.rows;
    const C1 = this.colsPart1;
    const C2 = this.colsPart2;
    const N1 = R * C1;
    if (len < N1 || len > N1 + R * C2) {
      throw new Error(
        `block-interleaver: comprimento ${len} fora da capacidade ` +
          `[${N1}, ${N1 + R * C2}]`,
      );
    }
    // grade[r][c] = indice de escrita w na celula (linha r, coluna global c),
    // ou -1 para celula vazia (parte 2 parcial). Colunas globais:
    // 0..C1-1 = parte 1, C1..C1+C2-1 = parte 2.
    const grid: number[][] = Array.from({ length: R }, () =>
      new Array<number>(C1 + C2).fill(-1),
    );
    for (let w = 0; w < len; w++) {
      const off = w < N1 ? w : w - N1;
      const col = Math.floor(off / R) + (w < N1 ? 0 : C1);
      const row = off % R;
      grid[row]![col] = w;
    }
    const perm = new Array<number>(len);
    let readIdx = 0;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C1 + C2; c++) {
        const w = grid[r]![c]!;
        if (w >= 0) perm[w] = readIdx++;
      }
    }
    this.permCache.set(len, perm);
    return perm;
  }
}
