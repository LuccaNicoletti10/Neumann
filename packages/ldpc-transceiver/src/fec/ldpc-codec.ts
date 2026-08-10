/**
 * ldpc-transceiver - src/fec/ldpc-codec.ts
 *
 * Codec LDPC quasi-ciclico (QC-LDPC) - implementa os componentes "LDPC encoder"
 * (transmissor) e "LDPC decoder" (receptor) descritos na familia de patentes
 * CA3111603 (Samsung, "Receiving apparatus and receiving method thereof").
 * Implementacao funcional independente: nao reproduz claims, apenas os
 * mecanismos genericos (matriz de paridade QC, encoder sistematico, decoder
 * por propagacao de crenca em log-domain).
 *
 * Estrutura da matriz H (M x N, M = N - K):
 *   H = [ Hi (M x K) | Hp (M x M) ]
 *   Hi: blocos circulantes Z x Z, cada bloco e' uma permutacao ciclica
 *       (peso de linha/coluna fixo por bloco) gerada deterministicamente
 *       via PRNG xorshift com seed.
 *   Hp: estrutura dual-diagonal em blocos Z x Z (identidade na diagonal e
 *       sub-diagonal, mais um bloco identidade extra no canto superior
 *       direito), o que permite encoder sistematico por varredura O(M)
 *       em GF(2).
 *
 * Presets:
 *   - qc648 : N=648, K=518 (rate ~4/5, inspirado em 12/15), Z=27
 *   - qc1296: N=1296, K=648 (rate 1/2), Z=27
 */

import { Xorshift32 } from "../utils/prng.js";

export type Bit = 0 | 1;

/** Parametros de um codigo QC-LDPC. */
export interface LdpcParams {
  /** Comprimento do codeword (N), multiplo de Z. */
  N: number;
  /** Numero de bits de informacao (K). */
  K: number;
  /** Fator de expansao Z (tamanho do bloco circulante). */
  Z: number;
  /** Peso de coluna da parte de informacao Hi (grau dv por coluna). */
  columnWeight: number;
  /** Seed do PRNG usado na construcao deterministica de Hi. */
  seed: number;
}

/** Preset N=648, rate 4/5 (12/15), Z=27. */
export const PRESET_QC648: LdpcParams = {
  N: 648,
  K: 518, // 518 = 648 - 130; K nao precisa ser multiplo de Z (padding interno).
  Z: 27,
  columnWeight: 3,
  seed: 0xc0ffee,
};

/** Preset N=1296, rate 1/2, Z=27. */
export const PRESET_QC1296: LdpcParams = {
  N: 1296,
  K: 648,
  Z: 27,
  columnWeight: 3,
  seed: 0x1d9c,
};

export const LDPC_PRESETS: Record<string, LdpcParams> = {
  qc648: PRESET_QC648,
  qc1296: PRESET_QC1296,
};

/**
 * Matriz esparsa em GF(2): lista de adjacencia check-node -> variable nodes.
 */
export interface ParityCheckMatrix {
  /** Numero de linhas (checks), M. */
  M: number;
  /** Numero de colunas (variables), N. */
  N: number;
  /** rows[m] = indices das colunas com 1 na linha m (ordenados). */
  rows: number[][];
  /** cols[n] = indices das linhas com 1 na coluna n (ordenados). */
  cols: number[][];
}

/**
 * Constroi a matriz de paridade QC-LDPC deterministica.
 *
 * @returns H = [Hi | Hp] em formato esparso, com Hp dual-diagonal por blocos.
 */
export function buildParityCheckMatrix(params: LdpcParams): ParityCheckMatrix {
  const { N, K, Z, columnWeight, seed } = params;
  if (N % Z !== 0) throw new Error(`N (${N}) deve ser multiplo de Z (${Z})`);
  if (K >= N) throw new Error(`K (${K}) deve ser menor que N (${N})`);
  const M = N - K;
  const MB = Math.ceil(M / Z); // numero de blocos de linha
  const KB = Math.ceil(K / Z); // numero de blocos de coluna de informacao
  const rng = new Xorshift32(seed);

  if (columnWeight < 2 || columnWeight > MB) {
    throw new Error(`columnWeight (${columnWeight}) deve estar em [2, ${MB}]`);
  }

  const rowSets: Set<number>[] = [];
  for (let m = 0; m < M; m++) rowSets.push(new Set<number>());

  // ---- Hi: construcao COLUNA-REGULAR. Para cada bloco de coluna de
  // informacao b (Z colunas, ultimo possivelmente parcial), escolhem-se
  // columnWeight blocos de linha distintos, cada um com um deslocamento
  // ciclico s. O bloco circulante (b, q, s) coloca um 1 em
  // (q*Z + r, b*Z + (r + s) mod Z) para r = 0..Z-1.
  // Isso garante grau exato columnWeight para TODA coluna de informacao
  // valida (mesmo no ultimo bloco parcial: apenas posicoes >= K sao
  // descartadas, e cada coluna valida continua recebendo exatamente um 1
  // por circulante). Blocos de linha distintos por coluna evitam pares de
  // 1s no mesmo bloco (reduz ciclos de tamanho 4).
  // Selecao balanceada: mantem a carga (numero de circulantes) de cada
  // bloco de linha o mais uniforme possivel, com desempate via PRNG -
  // regulariza o peso de linha de Hi (evita checks de grau muito alto/baixo)
  // preservando a aleatoriedade deterministica da seed.
  const load = new Array<number>(MB).fill(0);
  for (let b = 0; b < KB; b++) {
    const chosen = new Set<number>();
    while (chosen.size < columnWeight) {
      let bestLoad = Infinity;
      for (const q of load) bestLoad = Math.min(bestLoad, q);
      const candidates: number[] = [];
      for (let q = 0; q < MB; q++) {
        if (load[q] === bestLoad && !chosen.has(q)) candidates.push(q);
      }
      const q = candidates[rng.nextInt(candidates.length)]!;
      chosen.add(q);
      load[q]!++;
    }
    for (const q of chosen) {
      const s = rng.nextInt(Z);
      const rowsInBlock = Math.min(Z, M - q * Z);
      // Itera pelas colunas do bloco b: cada coluna valida recebe exatamente
      // um 1 por circulante (grau dv garantido). Em bloco de linha parcial
      // (M % Z != 0), o deslocamento faz wrap dentro das linhas validas.
      for (let j = 0; j < Z; j++) {
        const col = b * Z + j;
        if (col >= K) break;
        const o = (((j - s) % Z) + Z) % Z;
        const m = q * Z + (o % rowsInBlock);
        rowSets[m]!.add(col);
      }
    }
  }

  // ---- Hp: dual-diagonal em blocos, em coordenadas de paridade
  // (coluna absoluta = K + coordenada), o que independe do alinhamento K/Z.
  // Check m = q*Z + r contem:
  //   - diagonal: paridade q*Z + r
  //   - sub-diagonal: paridade (q+1)*Z + r (se < M)
  //   - extra (apenas q = 0): paridade (MB-1)*Z + r (se < M)
  // Resultado: o ultimo bloco tem grau 1 em Hp e o sistema resolve por
  // retro-substituicao O(M) (ou eliminacao gaussiana no caso geral).
  for (let q = 0; q < MB; q++) {
    for (let r = 0; r < Z; r++) {
      const m = q * Z + r;
      if (m >= M) break;
      const diag = q * Z + r;
      if (diag < M) rowSets[m]!.add(K + diag);
      const sub = (q + 1) * Z + r;
      if (sub < M) rowSets[m]!.add(K + sub);
      if (q === 0) {
        const extra = (MB - 1) * Z + r;
        if (extra < M) rowSets[m]!.add(K + extra);
      }
    }
  }

  // Monta formato esparso (linhas e colunas ordenadas).
  const rows: number[][] = rowSets.map((s) => Array.from(s).sort((a, b) => a - b));
  const cols: number[][] = Array.from({ length: N }, () => []);
  for (let m = 0; m < M; m++) {
    for (const n of rows[m]!) cols[n]!.push(m);
  }
  for (const c of cols) c.sort((a, b) => a - b);

  return { M, N, rows, cols };
}

/** Calcula a sindrome H * c^T (em GF(2)); vetor de M bits. */
export function computeSyndrome(H: ParityCheckMatrix, codeword: ArrayLike<number>): Bit[] {
  const syn: Bit[] = new Array<Bit>(H.M).fill(0);
  for (let m = 0; m < H.M; m++) {
    let acc = 0;
    for (const n of H.rows[m]!) acc ^= codeword[n]! & 1;
    syn[m] = (acc & 1) as Bit;
  }
  return syn;
}

/** Retorna true se H * c^T == 0. */
export function isCodeword(H: ParityCheckMatrix, codeword: ArrayLike<number>): boolean {
  return computeSyndrome(H, codeword).every((b) => b === 0);
}

/** Opcoes do decoder BP. */
export interface DecodeOptions {
  /** Maximo de iteracoes (default 30). */
  maxIterations?: number;
  /** Fator de escala min-sum normalizado (default 0.75; 1.0 = min-sum puro). */
  scaling?: number;
}

/** Resultado do decoder. */
export interface DecodeResult {
  /** Hard decision final (N bits). */
  hardBits: Bit[];
  /** Bits de informacao extraidos (primeiros K bits de hardBits). */
  infoBits: Bit[];
  /** Iteracoes efetivamente executadas. */
  iterations: number;
  /** true se a sindrome final e' zero (codeword valido encontrado). */
  syndromeOk: boolean;
  /** LLRs finais a posteriori. */
  llrs: Float64Array;
}

/**
 * Codec LDPC completo: encoder sistematico + decoder BP (min-sum normalizado).
 */
export class LdpcCodec {
  readonly params: LdpcParams;
  readonly H: ParityCheckMatrix;
  readonly N: number;
  readonly K: number;
  readonly M: number;
  readonly Z: number;
  private readonly KB: number;
  private readonly MB: number;

  constructor(params: LdpcParams) {
    this.params = params;
    this.H = buildParityCheckMatrix(params);
    this.N = params.N;
    this.K = params.K;
    this.M = params.N - params.K;
    this.Z = params.Z;
    this.KB = Math.ceil(this.K / this.Z);
    this.MB = Math.ceil(this.M / this.Z);
  }

  /** Cria codec a partir de preset nomeado. */
  static fromPreset(name: string): LdpcCodec {
    const preset = LDPC_PRESETS[name];
    if (!preset) {
      throw new Error(`Preset desconhecido: ${name}. Disponiveis: ${Object.keys(LDPC_PRESETS).join(", ")}`);
    }
    return new LdpcCodec(preset);
  }

  /**
   * Encoder sistematico: recebe K bits de informacao e devolve o codeword
   * c = [info (K) | paridade (M)] com H * c^T = 0.
   *
   * Estrutura dual-diagonal de Hp:
   *   check q, linha r:  s[q,r] XOR p[q,r] XOR p[q+1,r] (XOR p[MB-1,r] se q=0) = 0
   *   (com wraparound no ultimo bloco: p[MB] -> p[0], pois a coluna de
   *   sub-diagonal transborda para o bloco 0 de paridade).
   * Resolucao: z[r] = XOR_q s[q,r]; p[0,r] = z[r]; recorrencia direta.
   * Se M nao for multiplo de Z, resolve-se por eliminacao gaussiana sobre
   * o sistema linear dos bits de paridade (bitset por check) - ainda O(M^2/w).
   */
  encode(infoBits: ArrayLike<number>): Bit[] {
    if (infoBits.length !== this.K) {
      throw new Error(`encode: esperados ${this.K} bits de informacao, recebidos ${infoBits.length}`);
    }
    const cw: Bit[] = new Array<Bit>(this.N).fill(0);
    for (let n = 0; n < this.K; n++) cw[n] = (infoBits[n]! & 1) as Bit;

    // Contribuicao da informacao em cada check: s[m] = XOR de info em Hi.
    const s: Bit[] = new Array<Bit>(this.M).fill(0);
    for (let m = 0; m < this.M; m++) {
      let acc = 0;
      for (const n of this.H.rows[m]!) {
        if (n < this.K) acc ^= cw[n]!;
      }
      s[m] = (acc & 1) as Bit;
    }

    if (this.M % this.Z === 0) {
      this.encodeFastDualDiagonal(s, cw);
    } else {
      this.encodeGaussian(s, cw);
    }
    return cw;
  }

  /**
   * Caminho rapido O(M) quando M e' multiplo de Z (dual-diagonal).
   * Por residuo r, com x[q] = p[q*Z + r]:
   *   E_{MB-1}: x[MB-1] = s[(MB-1)*Z + r]                    (grau 1)
   *   E_q (1<=q<=MB-2): x[q] = s[q*Z + r] XOR x[q+1]         (retro-subst.)
   *   E_0: x[0] = s[r] XOR x[1] XOR x[MB-1]                  (termo extra)
   */
  private encodeFastDualDiagonal(s: Bit[], cw: Bit[]): void {
    const Z = this.Z;
    const MB = this.MB;
    for (let r = 0; r < Z; r++) {
      let last = s[(MB - 1) * Z + r]!;
      cw[this.K + (MB - 1) * Z + r] = last;
      let next = last; // x[q+1] corrente, descendo
      for (let q = MB - 2; q >= 1; q--) {
        next = (s[q * Z + r]! ^ next) as Bit;
        cw[this.K + q * Z + r] = next;
      }
      cw[this.K + r] = (s[r]! ^ next ^ last) as Bit;
    }
  }

  /**
   * Caminho geral: resolve Hp * p = s por eliminacao gaussiana em GF(2)
   * usando bitsets (Uint32Array). Cada equacao contem os bits de paridade
   * presentes no check m.
   */
  private encodeGaussian(s: Bit[], cw: Bit[]): void {
    const M = this.M;
    const words = Math.ceil(M / 32);
    // eqs[m] = bitset das variaveis de paridade do check m + rhs s[m].
    const eqs: Uint32Array[] = [];
    const rhs: number[] = new Array<number>(M);
    for (let m = 0; m < M; m++) {
      const bs = new Uint32Array(words);
      for (const n of this.H.rows[m]!) {
        if (n >= this.K) {
          const j = n - this.K;
          bs[j >>> 5]! |= 1 << (j & 31);
        }
      }
      eqs.push(bs);
      rhs[m] = s[m]!;
    }
    // Eliminacao para frente.
    for (let col = 0; col < M; col++) {
      // Acha pivot com bit col setado na linha >= col.
      let pivot = -1;
      for (let m = col; m < M; m++) {
        if ((eqs[m]![col >>> 5]! >>> (col & 31)) & 1) {
          pivot = m;
          break;
        }
      }
      if (pivot < 0) throw new Error(`encode: Hp singular na coluna ${col} (matriz nao invertivel)`);
      if (pivot !== col) {
        const te = eqs[col]!;
        eqs[col] = eqs[pivot]!;
        eqs[pivot] = te;
        const tr = rhs[col]!;
        rhs[col] = rhs[pivot]!;
        rhs[pivot] = tr;
      }
      for (let m = col + 1; m < M; m++) {
        if ((eqs[m]![col >>> 5]! >>> (col & 31)) & 1) {
          const a = eqs[m]!;
          const b = eqs[col]!;
          for (let w = 0; w < words; w++) a[w] = (a[w]! ^ b[w]!) >>> 0;
          rhs[m]! ^= rhs[col]!;
        }
      }
    }
    // Back-substitution.
    const p: Bit[] = new Array<Bit>(M).fill(0);
    for (let col = M - 1; col >= 0; col--) {
      let acc = rhs[col]!;
      const row = eqs[col]!;
      for (let j = col + 1; j < M; j++) {
        if ((row[j >>> 5]! >>> (j & 31)) & 1) acc ^= p[j]!;
      }
      p[col] = (acc & 1) as Bit;
    }
    for (let j = 0; j < M; j++) cw[this.K + j] = p[j]!;
  }

  /**
   * Decoder BP em log-domain (min-sum normalizado) sobre LLRs.
   * Convencao: LLR > 0 => bit 0 mais provavel (log P(0)/P(1)).
   */
  decode(llrIn: ArrayLike<number>, options: DecodeOptions = {}): DecodeResult {
    if (llrIn.length !== this.N) {
      throw new Error(`decode: esperados ${this.N} LLRs, recebidos ${llrIn.length}`);
    }
    const maxIter = options.maxIterations ?? 30;
    const alpha = options.scaling ?? 0.75;
    const { M, N, rows, cols } = this.H;

    // Mensagens check->var (q) e var->check (r), indexadas por aresta.
    // edgeIdx[m] mapeia posicao dentro de rows[m] para indice global de aresta.
    const numEdges = rows.reduce((acc, r) => acc + r.length, 0);
    const q = new Float64Array(numEdges); // check -> var
    const r = new Float64Array(numEdges); // var -> check

    // Layout: arestas agrupadas por check (row-major); edgeStart[m] e' o
    // offset da primeira aresta do check m. Inicializa var->check com o
    // LLR do canal.
    let eoff = 0;
    const edgeStart: number[] = new Array<number>(M);
    for (let m = 0; m < M; m++) {
      edgeStart[m] = eoff;
      for (let i = 0; i < rows[m]!.length; i++) {
        r[eoff + i] = llrIn[rows[m]![i]!]!;
      }
      eoff += rows[m]!.length;
    }

    const llrPost = new Float64Array(N);
    const hard: Bit[] = new Array<Bit>(N).fill(0);
    let iterations = 0;
    let syndromeOk = false;

    for (let iter = 1; iter <= maxIter; iter++) {
      iterations = iter;
      // ---- Check-node update (min-sum normalizado).
      for (let m = 0; m < M; m++) {
        const start = edgeStart[m]!;
        const len = rows[m]!.length;
        let sign = 1;
        let min1 = Infinity;
        let min2 = Infinity;
        let minIdx = -1;
        for (let i = 0; i < len; i++) {
          const v = r[start + i]!;
          if (v < 0) sign = -sign;
          const av = Math.abs(v);
          if (av < min1) {
            min2 = min1;
            min1 = av;
            minIdx = i;
          } else if (av < min2) {
            min2 = av;
          }
        }
        for (let i = 0; i < len; i++) {
          const mag = i === minIdx ? min2 : min1;
          let v = alpha * mag;
          if (!Number.isFinite(v)) v = 0; // aresta isolada (grau 1)
          q[start + i] = (r[start + i]! < 0 ? -1 : 1) * sign * v;
          // Nota: sinal proprio: q = sign_total * sign_i * mag, onde
          // sign_i = sinal da mensagem r_i.
        }
      }

      // ---- Variable-node update + LLR a posteriori + hard decision.
      // Para cada coluna, percorre suas arestas (via cols[m]).
      // Precisamos localizar a aresta (m, i) correspondente a coluna n:
      // buscamos i tal que rows[m][i] === n (graus sao pequenos).
      for (let n = 0; n < N; n++) {
        let total = llrIn[n]!;
        const checks = cols[n]!;
        const incoming: number[] = [];
        for (const m of checks) {
          const start = edgeStart[m]!;
          const row = rows[m]!;
          // busca linear no check (grau pequeno)
          let i = 0;
          while (row[i] !== n) i++;
          incoming.push(q[start + i]!);
          total += q[start + i]!;
        }
        llrPost[n] = total;
        // Mensagens extrinsecas de volta.
        for (let c = 0; c < checks.length; c++) {
          const m = checks[c]!;
          const start = edgeStart[m]!;
          const row = rows[m]!;
          let i = 0;
          while (row[i] !== n) i++;
          r[start + i] = total - incoming[c]!;
        }
      }

      // ---- Hard decision + sindrome (early stop).
      for (let n = 0; n < N; n++) hard[n] = llrPost[n]! >= 0 ? 0 : 1;
      syndromeOk = isCodeword(this.H, hard);
      if (syndromeOk) break;
    }

    return {
      hardBits: hard,
      infoBits: hard.slice(0, this.K),
      iterations,
      syndromeOk,
      llrs: llrPost,
    };
  }

  /**
   * Converte hard bits recebidos (apos canal BSC, por exemplo) em LLRs
   * com magnitude configuravel e decodifica.
   */
  decodeHard(receivedBits: ArrayLike<number>, llrMagnitude = 4, options: DecodeOptions = {}): DecodeResult {
    const llr = new Float64Array(this.N);
    for (let n = 0; n < this.N; n++) {
      llr[n] = receivedBits[n]! ? -llrMagnitude : llrMagnitude;
    }
    return this.decode(llr, options);
  }
}
