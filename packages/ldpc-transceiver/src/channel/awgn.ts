/**
 * ldpc-transceiver - src/channel/awgn.ts
 *
 * Canal AWGN (ruido gaussiano aditivo complexo) com PRNG proprio com seed
 * (Box-Muller), mais canal BSC (binary symmetric channel) para testes
 * isolados do decoder LDPC. Componente de canal entre o transmissor e o
 * receptor da familia CA3111603.
 */

import type { Complex } from "../modem/qam.js";
import { GaussianRng, Xorshift32 } from "../utils/prng.js";

/**
 * Converte SNR (dB, Es/N0 com energia media de simbolo 1) na variancia do
 * ruido por dimensao real: sigma^2 = 1 / (2 * 10^(snrDb/10)).
 */
export function snrDbToNoiseVar(snrDb: number): number {
  return 1 / (2 * Math.pow(10, snrDb / 10));
}

/** Canal AWGN deterministico (seed via GaussianRng). */
export class AwgnChannel {
  private readonly rng: GaussianRng;

  constructor(seed: number) {
    this.rng = new GaussianRng(seed);
  }

  /**
   * Adiciona ruido gaussiano complexo: cada dimensao (re/im) recebe uma
   * amostra N(0, noiseVar). Retorna novo vetor.
   */
  apply(symbols: ArrayLike<Complex>, noiseVar: number): Complex[] {
    const sigma = Math.sqrt(noiseVar);
    const out = new Array<Complex>(symbols.length);
    for (let i = 0; i < symbols.length; i++) {
      out[i] = {
        re: symbols[i]!.re + sigma * this.rng.nextGaussian(),
        im: symbols[i]!.im + sigma * this.rng.nextGaussian(),
      };
    }
    return out;
  }
}

/** Canal BSC deterministico: flipa cada bit com probabilidade p. */
export class BscChannel {
  private readonly rng: Xorshift32;

  constructor(
    seed: number,
    /** Probabilidade de flip por bit, em [0, 1]. */
    readonly flipProbability: number,
  ) {
    if (flipProbability < 0 || flipProbability > 1) {
      throw new Error("BscChannel: flipProbability deve estar em [0, 1]");
    }
    this.rng = new Xorshift32(seed);
  }

  /** Aplica o canal sobre um vetor de bits. Retorna novo vetor. */
  apply(bits: ArrayLike<number>): number[] {
    const out = new Array<number>(bits.length);
    for (let i = 0; i < bits.length; i++) {
      out[i] = (bits[i]! & 1) ^ (this.rng.nextFloat() < this.flipProbability ? 1 : 0);
    }
    return out;
  }
}
