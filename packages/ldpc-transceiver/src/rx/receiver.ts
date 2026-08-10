/**
 * ldpc-transceiver - src/rx/receiver.ts
 *
 * Receptor (componente "receiving apparatus" da familia CA3111603):
 * pipeline inversa  QAM demodulate (LLR) -> block deinterleave -> group
 * deinterleave -> parity deinterleave -> LDPC decode (BP) -> info bits.
 * Implementacao funcional independente, espelhando o Transmitter.
 */

import { BlockInterleaver } from "../fec/block-interleaver.js";
import { GroupInterleaver } from "../fec/group-interleaver.js";
import { ParityInterleaver } from "../fec/parity-interleaver.js";
import { LdpcCodec, type DecodeOptions } from "../fec/ldpc-codec.js";
import { demodulateLLR, type Complex } from "../modem/qam.js";
import { Transmitter, type TransmitterConfig } from "../tx/transmitter.js";

/** Configuracao do receptor (espelha TransmitterConfig + opcoes de decode). */
export interface ReceiverConfig extends TransmitterConfig {
  /** Maximo de iteracoes do decoder BP (default 30). */
  maxIterations?: number;
  /** Fator de escala min-sum (default 0.75). */
  scaling?: number;
}

/** Resultado da recepcao de um quadro. */
export interface ReceiveResult {
  /** Bits de informacao decodificados (K bits). */
  infoBits: number[];
  /** Hard decision completa (N bits, pos-deinterleave). */
  hardBits: number[];
  /** Iteracoes executadas pelo BP. */
  iterations: number;
  /** true se a sindrome final foi zero. */
  syndromeOk: boolean;
  /** LLRs de entrada do decoder (pos-deinterleave). */
  llrs: Float64Array;
}

/** Receptor completo (RX chain), espelhando um Transmitter. */
export class Receiver {
  readonly codec: LdpcCodec;
  readonly parity: ParityInterleaver;
  readonly group: GroupInterleaver;
  readonly block: BlockInterleaver;
  readonly config: ReceiverConfig;
  private readonly decodeOptions: DecodeOptions;
  private readonly modulation: Transmitter["modulation"];
  private readonly bitMapping?: number[];

  constructor(cfg: ReceiverConfig = {}) {
    this.config = cfg;
    // Reutiliza o Transmitter apenas para derivar os mesmos componentes
    // (garantia de espelhamento exato das configuracoes).
    const tx = new Transmitter(cfg);
    this.codec = tx.codec as LdpcCodec;
    this.parity = tx.parity;
    this.group = tx.group;
    this.block = tx.block;
    this.modulation = tx.modulation;
    if (tx.bitMapping) this.bitMapping = tx.bitMapping;
    this.decodeOptions = {
      maxIterations: cfg.maxIterations ?? 30,
      scaling: cfg.scaling ?? 0.75,
    };
  }

  /** Cria o par TX/RX espelhado a partir da mesma configuracao. */
  static pair(cfg: ReceiverConfig = {}): { tx: Transmitter; rx: Receiver } {
    return { tx: new Transmitter(cfg), rx: new Receiver(cfg) };
  }

  /** Executa a cadeia RX completa sobre simbolos recebidos. */
  receive(symbols: ArrayLike<Complex>, noiseVar: number): ReceiveResult {
    const llrMapped = demodulateLLR(symbols, this.modulation, noiseVar, {
      bitMapping: this.bitMapping,
    });
    const afterBlock = this.block.inverse(llrMapped);
    const afterGroup = this.group.inverse(afterBlock);
    const llrs = new Float64Array(this.parity.inverse(afterGroup));
    const res = this.codec.decode(llrs, this.decodeOptions);
    return {
      infoBits: res.infoBits,
      hardBits: res.hardBits,
      iterations: res.iterations,
      syndromeOk: res.syndromeOk,
      llrs,
    };
  }
}
