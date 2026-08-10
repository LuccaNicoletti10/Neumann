/**
 * Testes do codec QC-LDPC (encoder sistematico + decoder BP) - familia
 * CA3111603 (LDPC encoder/decoder).
 */
import { describe, expect, it } from "vitest";
import {
  LdpcCodec,
  LDPC_PRESETS,
  PRESET_QC1296,
  PRESET_QC648,
  buildParityCheckMatrix,
  computeSyndrome,
  isCodeword,
} from "../src/fec/ldpc-codec.js";
import { BscChannel } from "../src/channel/awgn.js";
import { generateInfoBits } from "../src/simulate.js";
import { countBitErrors } from "../src/utils/bits.js";
import { Xorshift32 } from "../src/utils/prng.js";

describe("construcao da matriz H (QC-LDPC)", () => {
  it("deterministica para a mesma seed", () => {
    const h1 = buildParityCheckMatrix(PRESET_QC648);
    const h2 = buildParityCheckMatrix(PRESET_QC648);
    expect(h1.rows).toEqual(h2.rows);
  });

  it("dimensoes corretas nos presets", () => {
    for (const p of [PRESET_QC648, PRESET_QC1296]) {
      const H = buildParityCheckMatrix(p);
      expect(H.M).toBe(p.N - p.K);
      expect(H.N).toBe(p.N);
      expect(H.rows).toHaveLength(p.N - p.K);
      expect(H.cols).toHaveLength(p.N);
    }
  });

  it("toda coluna de informacao tem grau >= 2 (sem bits desprotegidos)", () => {
    for (const p of [PRESET_QC648, PRESET_QC1296]) {
      const H = buildParityCheckMatrix(p);
      for (let n = 0; n < p.K; n++) {
        expect(H.cols[n]!.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("rejeita parametros invalidos", () => {
    expect(() => buildParityCheckMatrix({ ...PRESET_QC648, N: 100 })).toThrow();
    expect(() => buildParityCheckMatrix({ ...PRESET_QC648, K: 648 })).toThrow();
    expect(() => buildParityCheckMatrix({ ...PRESET_QC648, columnWeight: 1 })).toThrow();
  });
});

describe("encoder sistematico", () => {
  it.each(["qc648", "qc1296"])("H * c^T = 0 para codeword gerado (%s)", (preset) => {
    const codec = LdpcCodec.fromPreset(preset);
    const rng = new Xorshift32(1234);
    for (let t = 0; t < 5; t++) {
      const info = Array.from({ length: codec.K }, () => rng.nextBit());
      const cw = codec.encode(info);
      expect(cw).toHaveLength(codec.N);
      expect(isCodeword(codec.H, cw)).toBe(true);
      expect(computeSyndrome(codec.H, cw).every((b) => b === 0)).toBe(true);
      // sistematico: prefixo de informacao preservado
      expect(cw.slice(0, codec.K)).toEqual(info);
    }
  });

  it("caminho gaussiano (M nao multiplo de Z) tambem satisfaz a sindrome", () => {
    // qc648 tem M = 130 = 4*27 + 22 -> exercita encodeGaussian.
    const codec = new LdpcCodec(PRESET_QC648);
    expect(codec.M % codec.Z).not.toBe(0);
    const info = generateInfoBits(codec.K, 42);
    expect(isCodeword(codec.H, codec.encode(info))).toBe(true);
  });

  it("rejeita comprimento de informacao errado", () => {
    const codec = LdpcCodec.fromPreset("qc648");
    expect(() => codec.encode([0, 1, 0])).toThrow();
  });
});

describe("decoder BP", () => {
  it("decodifica sem ruido em 1 iteracao (LLRs fortes)", () => {
    const codec = LdpcCodec.fromPreset("qc1296");
    const info = generateInfoBits(codec.K, 7);
    const cw = codec.encode(info);
    const llr = Float64Array.from(cw, (b) => (b ? -8 : 8));
    const res = codec.decode(llr);
    expect(res.syndromeOk).toBe(true);
    expect(res.iterations).toBe(1);
    expect(res.infoBits).toEqual(info);
  });

  it("corrige erros em BSC leve (p=0.005, rate 4/5)", () => {
    const codec = new LdpcCodec(PRESET_QC648);
    for (let t = 0; t < 5; t++) {
      const info = generateInfoBits(codec.K, 500 + t);
      const cw = codec.encode(info);
      const recv = new BscChannel(900 + t, 0.005).apply(cw);
      const dec = codec.decodeHard(recv, 4, { maxIterations: 50 });
      expect(dec.syndromeOk).toBe(true);
      expect(countBitErrors(info, dec.infoBits)).toBe(0);
    }
  });

  it("corrige erros em BSC moderado (p=0.01, rate 1/2)", () => {
    const codec = new LdpcCodec(PRESET_QC1296);
    for (let t = 0; t < 3; t++) {
      const info = generateInfoBits(codec.K, 1500 + t);
      const cw = codec.encode(info);
      const recv = new BscChannel(2000 + t, 0.01).apply(cw);
      const dec = codec.decodeHard(recv, 4, { maxIterations: 50 });
      expect(dec.syndromeOk).toBe(true);
      expect(countBitErrors(info, dec.infoBits)).toBe(0);
    }
  });

  it("decodifica com LLRs de SNR alto (AWGN sobre BPSK simulado)", () => {
    const codec = new LdpcCodec(PRESET_QC648);
    const rng = new Xorshift32(77);
    const info = generateInfoBits(codec.K, 8);
    const cw = codec.encode(info);
    // LLR do canal: bit 0 -> +, bit 1 -> -, magnitude ~ N(8, 2) (SNR alto).
    const llr = Float64Array.from(cw, (b) => {
      const noise = (rng.nextFloat() - 0.5) * 4;
      return (b ? -1 : 1) * (8 + noise);
    });
    const res = codec.decode(llr);
    expect(res.syndromeOk).toBe(true);
    expect(res.infoBits).toEqual(info);
  });

  it("early stop: nao excede maxIterations e para na sindrome zero", () => {
    const codec = LdpcCodec.fromPreset("qc648");
    const info = generateInfoBits(codec.K, 9);
    const cw = codec.encode(info);
    const llr = Float64Array.from(cw, (b) => (b ? -6 : 6));
    const res = codec.decode(llr, { maxIterations: 100 });
    expect(res.iterations).toBeLessThan(100);
  });

  it("presets expostos", () => {
    expect(Object.keys(LDPC_PRESETS)).toEqual(["qc648", "qc1296"]);
    expect(() => LdpcCodec.fromPreset("inexistente")).toThrow();
  });
});
