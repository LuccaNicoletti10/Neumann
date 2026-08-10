/**
 * Testes dos interleavers (parity / group / block) e seus inversos -
 * componentes interleaver/deinterleaver da familia CA3111603.
 */
import { describe, expect, it } from "vitest";
import {
  ParityInterleaver,
  parityDeinterleave,
  parityInterleave,
} from "../src/fec/parity-interleaver.js";
import {
  GroupInterleaver,
  defaultPermutation,
  isPermutation,
} from "../src/fec/group-interleaver.js";
import { BlockInterleaver } from "../src/fec/block-interleaver.js";
import { generateInfoBits } from "../src/simulate.js";

function seq(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i % 2);
}

describe("parity interleaver", () => {
  const cfg = { K: 518, N: 648, Z: 27 };

  it("round-trip exato (apply + inverse = identidade)", () => {
    const il = new ParityInterleaver(cfg);
    for (let t = 0; t < 5; t++) {
      const cw = generateInfoBits(cfg.N, 10 + t);
      expect(il.inverse(il.apply(cw))).toEqual(cw);
    }
    // funcoes puras equivalentes
    const cw = generateInfoBits(cfg.N, 99);
    expect(parityDeinterleave(parityInterleave(cw, cfg), cfg)).toEqual(cw);
  });

  it("mantem os bits de informacao intocados", () => {
    const il = new ParityInterleaver(cfg);
    const cw = generateInfoBits(cfg.N, 11);
    const out = il.apply(cw);
    expect(out.slice(0, cfg.K)).toEqual(cw.slice(0, cfg.K));
  });

  it("altera a ordem dos bits de paridade (e e' permutacao)", () => {
    const il = new ParityInterleaver(cfg);
    // Marcadores unicos: usa contagem para provar permutacao.
    const cw = generateInfoBits(cfg.N, 12);
    const out = il.apply(cw);
    const count = (a: number[]): number => a.reduce((s, b) => s + b, 0);
    expect(count(out.slice(cfg.K))).toBe(count(cw.slice(cfg.K)));
    expect(out.slice(cfg.K)).not.toEqual(cw.slice(cfg.K));
  });

  it("funciona com M multiplo de Z e com residuo", () => {
    // N=1296, K=648, Z=27 -> M=648 (multiplo); N=648 -> M=130 (residuo 22).
    for (const c of [{ K: 648, N: 1296, Z: 27 }, cfg]) {
      const il = new ParityInterleaver(c);
      const cw = seq(c.N);
      expect(il.inverse(il.apply(cw))).toEqual(cw);
    }
  });
});

describe("group interleaver", () => {
  it("round-trip exato com permutacao default deterministica", () => {
    const N = 648;
    const groupSize = 36;
    const il = new GroupInterleaver({ groupSize }, N / groupSize);
    expect(il.numGroups).toBe(18);
    for (let t = 0; t < 3; t++) {
      const bits = generateInfoBits(N, 20 + t);
      expect(il.inverse(il.apply(bits))).toEqual(bits);
    }
  });

  it("satisfaz Y_j = X_pi(j)", () => {
    const groupSize = 4;
    const permutation = [2, 0, 1];
    const il = new GroupInterleaver({ groupSize, permutation });
    // Grupos com marcadores: X_0=0000, X_1=1111, X_2=0101
    const X = [0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1];
    const Y = il.apply(X);
    // Y_0 = X_2, Y_1 = X_0, Y_2 = X_1
    expect(Y.slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(Y.slice(4, 8)).toEqual([0, 0, 0, 0]);
    expect(Y.slice(8, 12)).toEqual([1, 1, 1, 1]);
    expect(il.inverse(Y)).toEqual(X);
  });

  it("permutacao default e' deterministica e valida", () => {
    const p1 = defaultPermutation(18, 0x360);
    const p2 = defaultPermutation(18, 0x360);
    expect(p1).toEqual(p2);
    expect(isPermutation(p1)).toBe(true);
    // nao trivial
    expect(p1.some((v, j) => v !== j)).toBe(true);
  });

  it("suporta grupo residual (ultimo grupo menor, fixo)", () => {
    // 650 bits, grupos de 36 -> 19 grupos (ultimo com 2 bits).
    const N = 650;
    const groupSize = 36;
    const numGroups = Math.ceil(N / groupSize);
    const perm = defaultPermutation(numGroups, 5);
    perm[perm.indexOf(numGroups - 1)] = perm[numGroups - 1]!;
    perm[numGroups - 1] = numGroups - 1; // mantem o residual fixo
    const il = new GroupInterleaver({ groupSize, permutation: perm });
    const bits = generateInfoBits(N, 33);
    expect(il.inverse(il.apply(bits))).toEqual(bits);
  });

  it("rejeita permutacao invalida e comprimento errado", () => {
    expect(() => new GroupInterleaver({ groupSize: 4, permutation: [0, 0, 1] })).toThrow();
    const il = new GroupInterleaver({ groupSize: 4, permutation: [1, 0] });
    expect(() => il.apply([0, 1, 0])).toThrow();
  });
});

describe("block interleaver (duas partes)", () => {
  it("round-trip exato em configuracao default do transmissor", () => {
    // rows=36, 9+9 colunas, N=648.
    const il = new BlockInterleaver({ rows: 36, colsPart1: 9, colsPart2: 9 });
    for (let t = 0; t < 3; t++) {
      const bits = generateInfoBits(648, 40 + t);
      expect(il.inverse(il.apply(bits))).toEqual(bits);
    }
  });

  it("escrita em coluna / leitura em linha (caso pequeno explicito)", () => {
    // R=2, parte1 com 1 coluna, parte2 com 2 colunas -> capacidade 2+4=6.
    const il = new BlockInterleaver({ rows: 2, colsPart1: 1, colsPart2: 2 });
    // Escrita: parte1 col0 = [b0,b1]; parte2 col0 = [b2,b3], col1 = [b4,b5].
    // Leitura por linha: linha0 = b0(p1c0), b2(p2c0), b4(p2c1);
    //                    linha1 = b1, b3, b5.
    const input = [0, 1, 2, 3, 4, 5].map((v) => v); // marcadores
    const out = il.apply(input);
    expect(out).toEqual([0, 2, 4, 1, 3, 5]);
    expect(il.inverse(out)).toEqual(input);
  });

  it("parte 2 parcial (ultima coluna incompleta)", () => {
    const il = new BlockInterleaver({ rows: 10, colsPart1: 2, colsPart2: 3 });
    // capacidade: 20..50; usa 35 (parte2 com 15 bits -> col1 parcial).
    const bits = generateInfoBits(35, 55);
    expect(il.inverse(il.apply(bits))).toEqual(bits);
  });

  it("permutacao e' de fato uma permutacao", () => {
    const il = new BlockInterleaver({ rows: 36, colsPart1: 9, colsPart2: 9 });
    const perm = il.permutation(648);
    const sorted = [...perm].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 648 }, (_, i) => i));
  });

  it("rejeita comprimentos fora da capacidade", () => {
    const il = new BlockInterleaver({ rows: 4, colsPart1: 1, colsPart2: 1 });
    expect(() => il.apply([0, 1, 0])).toThrow(); // < rows*colsPart1
    expect(() => il.apply([0, 1, 0, 1, 0, 1, 0, 1, 0])).toThrow(); // > capacidade
  });
});
