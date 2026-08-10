/**
 * ldpc-transceiver - src/utils/prng.ts
 *
 * PRNG deterministico com seed (xorshift32) e gerador gaussiano Box-Muller.
 * Utilizado em toda a cadeia (construcao da matriz LDPC, canal AWGN, BSC)
 * para garantir testes 100% deterministicos - nenhum uso de Math.random.
 *
 * Componente da patente relacionado: infraestrutura de suporte ao
 * transmissor/receptor (familia CA3111603) - aqui apenas utilitario interno.
 */

/** PRNG xorshift32 deterministico. */
export class Xorshift32 {
  private state: number;

  constructor(seed: number) {
    // Estado nao pode ser zero (xorshift trava); mistura simples para seeds 0.
    let s = (seed >>> 0) ^ 0x9e3779b9;
    if (s === 0) s = 0x1;
    this.state = s >>> 0;
  }

  /** Proximo inteiro de 32 bits (uint32). */
  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x;
  }

  /** Float uniforme em [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }

  /** Inteiro uniforme em [0, n). */
  nextInt(n: number): number {
    if (n <= 0) throw new Error(`nextInt: n deve ser > 0 (recebido ${n})`);
    return this.nextUint32() % n;
  }

  /** Bit uniforme {0,1}. */
  nextBit(): 0 | 1 {
    return (this.nextUint32() & 1) as 0 | 1;
  }
}

/** Gerador gaussiano Box-Muller com seed (pares de normais padrao N(0,1)). */
export class GaussianRng {
  private readonly rng: Xorshift32;
  private spare: number | null = null;

  constructor(seed: number) {
    this.rng = new Xorshift32(seed);
  }

  /** Proxima amostra ~ N(0, 1). */
  nextGaussian(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    // Evita log(0).
    do {
      u = this.rng.nextFloat();
    } while (u <= 0);
    const v = this.rng.nextFloat();
    const r = Math.sqrt(-2.0 * Math.log(u));
    const theta = 2.0 * Math.PI * v;
    this.spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  }
}
