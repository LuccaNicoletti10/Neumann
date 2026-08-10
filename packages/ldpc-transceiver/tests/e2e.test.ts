/**
 * Testes ponta a ponta TX -> canal -> RX (cadeia completa da familia
 * CA3111603: encoder -> interleavers -> modulador -> demodulador ->
 * deinterleavers -> decoder).
 */
import { describe, expect, it } from "vitest";
import { Receiver } from "../src/rx/receiver.js";
import { Transmitter } from "../src/tx/transmitter.js";
import { AwgnChannel, snrDbToNoiseVar } from "../src/channel/awgn.js";
import { generateInfoBits, simulateFrame } from "../src/simulate.js";
import { countBitErrors } from "../src/utils/bits.js";
import type { QamOrder } from "../src/modem/qam.js";

const ORDERS: QamOrder[] = ["QPSK", "16QAM", "64QAM", "256QAM"];

describe("round-trip sem ruido", () => {
  it.each(ORDERS)("TX->RX exato sem ruido (%s, qc648)", (modulation) => {
    const { tx, rx } = Receiver.pair({ preset: "qc648", modulation });
    const info = generateInfoBits(tx.K, 5);
    const res = rx.receive(tx.transmit(info).symbols, 1e-6);
    expect(res.syndromeOk).toBe(true);
    expect(res.infoBits).toEqual(info);
  });

  it("TX->RX exato sem ruido (qc1296)", () => {
    const { tx, rx } = Receiver.pair({ preset: "qc1296", modulation: "16QAM" });
    const info = generateInfoBits(tx.K, 6);
    const res = rx.receive(tx.transmit(info).symbols, 1e-6);
    expect(res.infoBits).toEqual(info);
  });

  it("permutacao custom do group interleaver preserva o round-trip", () => {
    const permutation = Array.from({ length: 18 }, (_, i) => (i * 7) % 18);
    const cfg = { preset: "qc648", modulation: "16QAM" as const, groupSize: 36, permutation };
    const { tx, rx } = Receiver.pair(cfg);
    const info = generateInfoBits(tx.K, 60);
    const res = rx.receive(tx.transmit(info).symbols, 1e-6);
    expect(res.infoBits).toEqual(info);
  });
});

describe("AWGN", () => {
  it("BER ~ 0 em SNR alto (12 dB, 10 frames, seed fixa, qc648 16QAM)", () => {
    const { tx, rx } = Receiver.pair({ preset: "qc648", modulation: "16QAM" });
    const channel = new AwgnChannel(99);
    const noiseVar = snrDbToNoiseVar(12);
    let errors = 0;
    for (let f = 0; f < 10; f++) {
      const info = generateInfoBits(tx.K, 1000 + f);
      const rxRes = rx.receive(channel.apply(tx.transmit(info).symbols, noiseVar), noiseVar);
      errors += countBitErrors(info, rxRes.infoBits);
    }
    expect(errors).toBe(0);
  });

  it("BER ~ 0 em SNR alto (10 dB, qc1296)", () => {
    const { tx, rx } = Receiver.pair({ preset: "qc1296", modulation: "16QAM" });
    const channel = new AwgnChannel(7);
    const noiseVar = snrDbToNoiseVar(10);
    let errors = 0;
    for (let f = 0; f < 5; f++) {
      const info = generateInfoBits(tx.K, 3000 + f);
      const rxRes = rx.receive(channel.apply(tx.transmit(info).symbols, noiseVar), noiseVar);
      errors += countBitErrors(info, rxRes.infoBits);
    }
    expect(errors).toBe(0);
  });

  it("monotonicidade: BER em SNR baixo > BER em SNR alto", () => {
    const berAt = (snrDb: number, frames: number, seed: number): number => {
      const { tx, rx } = Receiver.pair({ preset: "qc648", modulation: "16QAM" });
      const channel = new AwgnChannel(seed);
      const noiseVar = snrDbToNoiseVar(snrDb);
      let errors = 0;
      let bits = 0;
      for (let f = 0; f < frames; f++) {
        const info = generateInfoBits(tx.K, seed * 10 + f);
        const rxRes = rx.receive(channel.apply(tx.transmit(info).symbols, noiseVar), noiseVar);
        errors += countBitErrors(info, rxRes.infoBits);
        bits += info.length;
      }
      return errors / bits;
    };
    const low = berAt(4, 5, 11);
    const high = berAt(12, 5, 11);
    expect(low).toBeGreaterThan(high);
    expect(high).toBe(0);
    expect(low).toBeGreaterThan(0);
  });

  it("simulateFrame: helper ponta a ponta consistente", () => {
    const { tx } = Receiver.pair({ preset: "qc648", modulation: "16QAM" });
    const info = generateInfoBits(tx.K, 123);
    const r = simulateFrame(info, { preset: "qc648", modulation: "16QAM", snrDb: 12, channelSeed: 5 });
    expect(r.errors).toBe(0);
    expect(r.ber).toBe(0);
    expect(r.syndromeOk).toBe(true);
    expect(r.infoBits).toEqual(info);
  });

  it("canal deterministico: mesma seed => mesmo ruido", () => {
    const tx = new Transmitter({ preset: "qc648" });
    const t = tx.transmit(generateInfoBits(tx.K, 1));
    const a = new AwgnChannel(42).apply(t.symbols, 0.1);
    const b = new AwgnChannel(42).apply(t.symbols, 0.1);
    expect(a).toEqual(b);
  });
});
