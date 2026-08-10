/**
 * ldpc-transceiver - src/modem/qam.ts
 *
 * Modulador/demodulador QAM (componentes "modulator" e "demodulator" da
 * familia CA3111603). Constelacoes QPSK, 16QAM, 64QAM e 256QAM com
 * mapeamento Gray e energia media normalizada para 1.
 *
 * Convencao de LLR: LLR > 0 => bit 0 mais provavel (log P(0)/P(1)).
 * Demodulacao log-MAP exata:
 *   LLR_j = log( sum_{s: bit_j=0} exp(-|y-s|^2 / (2*sigma^2))
 *               / sum_{s: bit_j=1} exp(-|y-s|^2 / (2*sigma^2)) )
 * com estabilidade numerica via log-sum-exp.
 *
 * Mapeamento grupo->posicao de bit no simbolo: o modulador pode receber uma
 * tabela explicita (`bitMapping`, permutacao dos indices de bit do quadro)
 * que determina qual bit de entrada ocupa cada posicao de bit de simbolo;
 * default: identidade (apos a cadeia de interleavers).
 */

/** Simbolo complexo. */
export interface Complex {
  re: number;
  im: number;
}

/** Ordens suportadas. */
export type QamOrder = "QPSK" | "16QAM" | "64QAM" | "256QAM";

interface ConstellationPoint extends Complex {
  /** Indice inteiro do simbolo (bits concatenados, MSB = dimensao I). */
  index: number;
}

const BITS_PER_SYMBOL: Record<QamOrder, number> = {
  QPSK: 2,
  "16QAM": 4,
  "64QAM": 6,
  "256QAM": 8,
};

const constellationCache = new Map<QamOrder, ConstellationPoint[]>();

/** Converte inteiro binario para codigo Gray. */
function toGray(v: number): number {
  return v ^ (v >> 1);
}

/**
 * Constroi (e cacheia) a constelacao QAM quadrada com Gray mapping e
 * energia media 1. O indice do simbolo junta os bits de I (mais
 * significativos) e Q; em cada dimensao, bits Gray 0..L-1 mapeiam para
 * niveis -(L-1)d .. +(L-1)d.
 */
export function getConstellation(order: QamOrder): ConstellationPoint[] {
  const cached = constellationCache.get(order);
  if (cached) return cached;
  const m = BITS_PER_SYMBOL[order];
  const k = m / 2; // bits por dimensao
  const L = 1 << k; // niveis PAM por dimensao
  const d = Math.sqrt(3 / (2 * (L * L - 1))); // normalizacao de energia
  const points: ConstellationPoint[] = new Array<ConstellationPoint>(1 << m);
  for (let iBin = 0; iBin < L; iBin++) {
    for (let qBin = 0; qBin < L; qBin++) {
      const iGray = toGray(iBin);
      const qGray = toGray(qBin);
      const index = (iGray << k) | qGray;
      points[index] = {
        re: (2 * iBin - (L - 1)) * d,
        im: (2 * qBin - (L - 1)) * d,
        index,
      };
    }
  }
  constellationCache.set(order, points);
  return points;
}

/** Bits por simbolo da ordem. */
export function bitsPerSymbol(order: QamOrder): number {
  return BITS_PER_SYMBOL[order];
}

/** Opcoes de modulacao/demodulacao. */
export interface QamMapOptions {
  /**
   * Tabela group->symbolBitPosition generalizada: permutacao dos indices de
   * bit do quadro; outBits[bitMapping[i]] = inBits[i]. Default: identidade.
   */
  bitMapping?: number[];
}

/**
 * Modula bits em simbolos QAM. O numero de bits deve ser multiplo de
 * bitsPerSymbol(order). Se bitMapping for fornecido, aplica-se primeiro a
 * permutacao (mapeamento grupo->posicao de bit de simbolo).
 */
export function modulate(bits: ArrayLike<number>, order: QamOrder, options: QamMapOptions = {}): Complex[] {
  const m = BITS_PER_SYMBOL[order];
  const constellation = getConstellation(order);
  const mapped = applyBitMapping(bits, options.bitMapping);
  if (mapped.length % m !== 0) {
    throw new Error(`qam.modulate: ${mapped.length} bits nao e' multiplo de ${m} (${order})`);
  }
  const out: Complex[] = new Array<Complex>(mapped.length / m);
  for (let s = 0; s < out.length; s++) {
    let index = 0;
    for (let b = 0; b < m; b++) index = (index << 1) | (mapped[s * m + b]! & 1);
    out[s] = constellation[index]!;
  }
  return out;
}

/**
 * Demodula simbolos em LLRs por bit (log-MAP exato).
 * @param noiseVar variancia do ruido por dimensao real (sigma^2).
 */
export function demodulateLLR(
  symbols: ArrayLike<Complex>,
  order: QamOrder,
  noiseVar: number,
  options: QamMapOptions = {},
): Float64Array {
  if (!(noiseVar > 0)) throw new Error(`qam.demodulateLLR: noiseVar deve ser > 0 (recebido ${noiseVar})`);
  const m = BITS_PER_SYMBOL[order];
  const constellation = getConstellation(order);
  const numSymbols = symbols.length;
  const llr = new Float64Array(numSymbols * m);
  const inv2s2 = 1 / (2 * noiseVar);
  // Pre-particiona a constelacao por valor de cada bit.
  const zeroSets: number[][] = [];
  const oneSets: number[][] = [];
  for (let b = 0; b < m; b++) {
    const zeros: number[] = [];
    const ones: number[] = [];
    for (const p of constellation) {
      if (((p.index >> (m - 1 - b)) & 1) === 0) zeros.push(p.index);
      else ones.push(p.index);
    }
    zeroSets.push(zeros);
    oneSets.push(ones);
  }
  for (let s = 0; s < numSymbols; s++) {
    const y = symbols[s]!;
    // Metricas de todos os pontos (reutilizadas por bit).
    const metric = new Float64Array(constellation.length);
    for (const p of constellation) {
      const dr = y.re - p.re;
      const di = y.im - p.im;
      metric[p.index] = -(dr * dr + di * di) * inv2s2;
    }
    for (let b = 0; b < m; b++) {
      const lse0 = logSumExp(metric, zeroSets[b]!);
      const lse1 = logSumExp(metric, oneSets[b]!);
      llr[s * m + b] = lse0 - lse1;
    }
  }
  return invertBitMapping(llr, numSymbols * m, options.bitMapping);
}

/** Hard decision: bit = 1 se LLR < 0. */
export function hardDecision(llr: ArrayLike<number>): number[] {
  const out = new Array<number>(llr.length);
  for (let i = 0; i < llr.length; i++) out[i] = llr[i]! < 0 ? 1 : 0;
  return out;
}

function logSumExp(metric: Float64Array, idxs: number[]): number {
  let max = -Infinity;
  for (const i of idxs) if (metric[i]! > max) max = metric[i]!;
  let sum = 0;
  for (const i of idxs) sum += Math.exp(metric[i]! - max);
  return max + Math.log(sum);
}

function applyBitMapping(bits: ArrayLike<number>, mapping?: number[]): number[] {
  const n = bits.length;
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = bits[i]! & 1;
  if (!mapping) return arr;
  if (mapping.length !== n) {
    throw new Error(`qam bitMapping: esperado ${n} entradas, recebido ${mapping.length}`);
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[mapping[i]!] = arr[i]!;
  return out;
}

function invertBitMapping(llr: Float64Array, n: number, mapping?: number[]): Float64Array {
  if (!mapping) return llr;
  if (mapping.length !== n) {
    throw new Error(`qam bitMapping: esperado ${n} entradas, recebido ${mapping.length}`);
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = llr[mapping[i]!]!;
  return out;
}
