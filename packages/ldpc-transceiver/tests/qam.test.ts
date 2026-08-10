/**
 * Testes do modulador/demodulador QAM (Gray, energia media 1, LLR log-MAP) -
 * componentes modulator/demodulator da familia CA3111603.
 */
import { describe, expect, it } from "vitest";
import {
  bitsPerSymbol,
  demodulateLLR,
  getConstellation,
  hardDecision,
  modulate,
  type QamOrder,
} from "../src/modem/qam.js";
import { generateInfoBits } from "../src/simulate.js";

const ORDERS: QamOrder[] = ["QPSK", "16QAM", "64QAM", "256QAM"];

describe("constelacoes QAM", () => {
  it.each(ORDERS)("energia media ~ 1 (%s)", (order) => {
    const c = getConstellation(order);
    const avg = c.reduce((s, p) => s + p.re * p.re + p.im * p.im, 0) / c.length;
    expect(avg).toBeCloseTo(1, 10);
  });

  it.each(ORDERS)("tamanho da constelacao (%s)", (order) => {
    const m = bitsPerSymbol(order);
    expect(getConstellation(order)).toHaveLength(1 << m);
  });

  it.each(ORDERS)("Gray: vizinhos adjacentes diferem em exatamente 1 bit (%s)", (order) => {
    const c = getConstellation(order);
    const m = bitsPerSymbol(order);
    // Para cada par de pontos a distancia minima (adjacentes na grade),
    // os indices devem diferir em 1 bit. Distancia minima = menor distancia
    // entre pontos distintos.
    let dmin = Infinity;
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const d = Math.hypot(c[i]!.re - c[j]!.re, c[i]!.im - c[j]!.im);
        dmin = Math.min(dmin, d);
      }
    }
    let checked = 0;
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const d = Math.hypot(c[i]!.re - c[j]!.re, c[i]!.im - c[j]!.im);
        if (Math.abs(d - dmin) < 1e-12) {
          const xor = c[i]!.index ^ c[j]!.index;
          const bits = xor.toString(2).split("").filter((ch) => ch === "1").length;
          expect(bits).toBe(1);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(m).toBeGreaterThanOrEqual(2);
  });
});

describe("modulacao/demodulacao", () => {
  it.each(ORDERS)("demod sem ruido recupera os bits exatos (%s)", (order) => {
    const m = bitsPerSymbol(order);
    const bits = generateInfoBits(m * 40, 77);
    const symbols = modulate(bits, order);
    expect(symbols).toHaveLength(40);
    const llr = demodulateLLR(symbols, order, 0.01);
    expect(hardDecision(llr)).toEqual(bits);
  });

  it("LLR com sinal correto e magnitude crescente com SNR", () => {
    const bits = [0, 1, 0, 1];
    const symbols = modulate(bits, "QPSK");
    const llrHigh = demodulateLLR(symbols, "QPSK", 0.001);
    const llrLow = demodulateLLR(symbols, "QPSK", 0.5);
    // bit 0 -> LLR > 0; bit 1 -> LLR < 0
    expect(llrHigh[0]!).toBeGreaterThan(0);
    expect(llrHigh[1]!).toBeLessThan(0);
    expect(Math.abs(llrHigh[0]!)).toBeGreaterThan(Math.abs(llrLow[0]!));
  });

  it("bitMapping custom (tabela group->symbolBitPosition) e' aplicado e invertido", () => {
    const m = bitsPerSymbol("16QAM");
    const n = m * 4;
    // Permutacao reversa como "tabela" de mapeamento.
    const mapping = Array.from({ length: n }, (_, i) => n - 1 - i);
    const bits = generateInfoBits(n, 88);
    const symbols = modulate(bits, "16QAM", { bitMapping: mapping });
    const ref = modulate([...bits].reverse(), "16QAM");
    expect(symbols).toEqual(ref);
    const llr = demodulateLLR(symbols, "16QAM", 0.01, { bitMapping: mapping });
    expect(hardDecision(llr)).toEqual(bits);
  });

  it("rejeita comprimento invalido e noiseVar invalida", () => {
    expect(() => modulate([0, 1, 0], "16QAM")).toThrow();
    expect(() => demodulateLLR([{ re: 0, im: 0 }], "QPSK", 0)).toThrow();
  });
});
