/**
 * ldpc-transceiver - src/tx/transmitter.ts
 *
 * Transmissor (componente "transmitting apparatus" da familia CA3111603):
 * pipeline  info bits -> LDPC encode -> parity interleave -> group
 * interleave -> block interleave -> QAM modulate.
 * Implementacao funcional independente, sem copia de claims.
 */

import { BlockInterleaver, type BlockInterleaverConfig } from "../fec/block-interleaver.js";
import { GroupInterleaver } from "../fec/group-interleaver.js";
import { ParityInterleaver } from "../fec/parity-interleaver.js";
import {
  LDPC_PRESETS,
  LdpcCodec,
  PRESET_QC648,
  type LdpcParams,
} from "../fec/ldpc-codec.js";
import { bitsPerSymbol, modulate, type Complex, type QamOrder } from "../modem/qam.js";

/** Configuracao do transmissor. */
export interface TransmitterConfig {
  /** Parametros do codigo LDPC (default PRESET_QC648). */
  code?: LdpcParams;
  /** Nome de preset LDPC (alternativa a `code`; ex.: "qc648", "qc1296"). */
  preset?: string;
  /** Tamanho do grupo do group interleaver (default: divisor de N em [30, 360]). */
  groupSize?: number;
  /** Permutacao custom do group interleaver (pi[j] = grupo de origem). */
  permutation?: number[];
  /** Ordem de modulacao (default "16QAM"). */
  modulation?: QamOrder;
  /** Config do block interleaver (default derivado de N e da modulacao). */
  block?: BlockInterleaverConfig;
  /** Tabela group->symbolBitPosition do modulador (default identidade). */
  bitMapping?: number[];
  /** Seed das permutacoes deterministicas (default 0x360). */
  seed?: number;
}

/** Resultado da transmissao de um quadro. */
export interface TransmitResult {
  /** Codeword LDPC [info | paridade] (antes dos interleavers). */
  codeword: number[];
  /** Bits finais apos toda a cadeia de interleavers (entrada do modulador). */
  interleaved: number[];
  /** Simbolos QAM transmitidos. */
  symbols: Complex[];
}

/** Escolhe um groupSize padrao: menor divisor de N >= 30 (fallback: N). */
export function defaultGroupSize(N: number): number {
  for (let g = 30; g <= Math.min(360, N); g++) {
    if (N % g === 0) return g;
  }
  return N;
}

/** Deriva a config padrao do block interleaver. */
export function defaultBlockConfig(N: number, groupSize: number, modulation: QamOrder): BlockInterleaverConfig {
  const rows = groupSize;
  const m = bitsPerSymbol(modulation);
  const totalCols = Math.ceil(N / rows);
  // Duas partes; parte 1 com metade das colunas (arredondando para baixo),
  // parte 2 com o restante (sempre >= 1).
  let colsPart1 = Math.floor(totalCols / 2);
  const colsPart2 = totalCols - colsPart1;
  if (colsPart1 === 0) colsPart1 = Math.max(1, Math.min(m, totalCols - 1));
  return { rows, colsPart1, colsPart2 };
}

/** Transmissor completo (TX chain). */
export class Transmitter {
  readonly codec: LdpcCodec;
  readonly parity: ParityInterleaver;
  readonly group: GroupInterleaver;
  readonly block: BlockInterleaver;
  readonly modulation: QamOrder;
  readonly bitMapping?: number[];

  constructor(cfg: TransmitterConfig = {}) {
    const code = cfg.code ?? (cfg.preset ? LDPC_PRESETS[cfg.preset] : undefined) ?? PRESET_QC648;
    if (cfg.preset && !LDPC_PRESETS[cfg.preset]) {
      throw new Error(`Preset desconhecido: ${cfg.preset}`);
    }
    this.codec = new LdpcCodec(code);
    const N = this.codec.N;
    this.modulation = cfg.modulation ?? "16QAM";
    const groupSize = cfg.groupSize ?? defaultGroupSize(N);
    const numGroups = Math.ceil(N / groupSize);
    this.parity = new ParityInterleaver({ K: this.codec.K, N, Z: this.codec.Z });
    this.group = new GroupInterleaver(
      { groupSize, permutation: cfg.permutation, seed: cfg.seed ?? 0x360 },
      cfg.permutation ? undefined : numGroups,
    );
    this.block = new BlockInterleaver(
      cfg.block ?? defaultBlockConfig(N, groupSize, this.modulation),
    );
    if (cfg.bitMapping) this.bitMapping = [...cfg.bitMapping];
    const numBits = N;
    if (numBits % bitsPerSymbol(this.modulation) !== 0) {
      throw new Error(
        `Transmitter: N=${numBits} nao e' multiplo de ${bitsPerSymbol(this.modulation)} bits/simbolo (${this.modulation})`,
      );
    }
  }

  get N(): number {
    return this.codec.N;
  }

  get K(): number {
    return this.codec.K;
  }

  /** Executa a cadeia TX completa sobre K bits de informacao. */
  transmit(infoBits: ArrayLike<number>): TransmitResult {
    if (infoBits.length !== this.K) {
      throw new Error(`Transmitter.transmit: esperados ${this.K} bits de informacao, recebidos ${infoBits.length}`);
    }
    const codeword = this.codec.encode(infoBits);
    const afterParity = this.parity.apply(codeword);
    const afterGroup = this.group.apply(afterParity);
    const interleaved = this.block.apply(afterGroup);
    const symbols = modulate(interleaved, this.modulation, {
      bitMapping: this.bitMapping,
    });
    return { codeword, interleaved, symbols };
  }
}
