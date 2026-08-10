/**
 * ldpc-transceiver - src/simulate.ts
 *
 * Simulacao ponta a ponta (TX -> AWGN -> RX) da cadeia da familia
 * CA3111603, usada pelo servidor HTTP, pela CLI e pelos testes e2e.
 */

import { AwgnChannel, snrDbToNoiseVar } from "./channel/awgn.js";
import { Receiver, type ReceiverConfig } from "./rx/receiver.js";
import { countBitErrors } from "./utils/bits.js";
import { Xorshift32 } from "./utils/prng.js";

/** Opcoes de simulacao. */
export interface SimulateOptions extends ReceiverConfig {
  /** SNR em dB (Es/N0). */
  snrDb: number;
  /** Seed do canal AWGN (default 1). */
  channelSeed?: number;
}

/** Resultado da simulacao de um quadro. */
export interface SimulateResult {
  infoBits: number[];
  errors: number;
  ber: number;
  iterations: number;
  syndromeOk: boolean;
}

/** Gera bits de informacao deterministicos, simula TX->AWGN->RX e mede BER. */
export function simulateFrame(infoBits: number[], options: SimulateOptions): SimulateResult {
  const { tx, rx } = Receiver.pair(options);
  const noiseVar = snrDbToNoiseVar(options.snrDb);
  const channel = new AwgnChannel(options.channelSeed ?? 1);
  const txRes = tx.transmit(infoBits);
  const received = channel.apply(txRes.symbols, noiseVar);
  const rxRes = rx.receive(received, noiseVar);
  const errors = countBitErrors(infoBits, rxRes.infoBits);
  return {
    infoBits: rxRes.infoBits,
    errors,
    ber: errors / infoBits.length,
    iterations: rxRes.iterations,
    syndromeOk: rxRes.syndromeOk,
  };
}

/** Gera um quadro de informacao pseudo-aleatorio deterministico. */
export function generateInfoBits(K: number, seed: number): number[] {
  const rng = new Xorshift32(seed);
  return Array.from({ length: K }, () => rng.nextBit());
}
