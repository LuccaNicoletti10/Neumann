#!/usr/bin/env node
/**
 * ldpc-transceiver - src/cli.ts
 *
 * CLI do transceptor LDPC (familia CA3111603):
 *   simulate --snr <db> [--mod 16QAM] [--preset qc648] [--frames 1] [--seed 1]
 *   encode --hex <info> [--mod ...] [--preset ...]
 *   decode --symbols <arquivo.json> --noise-var <v> [--preset ...]
 *   serve --port <porta>
 */

import { readFile } from "node:fs/promises";
import { Receiver } from "./rx/receiver.js";
import { Transmitter } from "./tx/transmitter.js";
import { AwgnChannel, snrDbToNoiseVar } from "./channel/awgn.js";
import { generateInfoBits } from "./simulate.js";
import { startServer } from "./server/index.js";
import { bitsToHex, countBitErrors, hexToBits } from "./utils/bits.js";
import { LDPC_PRESETS } from "./fec/ldpc-codec.js";
import type { QamOrder } from "./modem/qam.js";

interface Args {
  cmd: string;
  opts: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const opts = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts.set(key, next);
        i++;
      } else {
        opts.set(key, "true");
      }
    }
  }
  return { cmd, opts };
}

function rxConfig(opts: Map<string, string>): ConstructorParameters<typeof Receiver>[0] {
  const cfg: NonNullable<ConstructorParameters<typeof Receiver>[0]> = {};
  const preset = opts.get("preset");
  if (preset) {
    if (!LDPC_PRESETS[preset]) throw new Error(`preset desconhecido: ${preset}`);
    cfg.preset = preset;
  }
  const mod = opts.get("mod");
  if (mod) cfg.modulation = mod as QamOrder;
  const groupSize = opts.get("group-size");
  if (groupSize) cfg.groupSize = Number(groupSize);
  const maxIter = opts.get("max-iter");
  if (maxIter) cfg.maxIterations = Number(maxIter);
  return cfg;
}

function pad8(bits: number[]): number[] {
  const out = [...bits];
  while (out.length % 8 !== 0) out.push(0);
  return out;
}

async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv.slice(2));

  switch (cmd) {
    case "simulate": {
      const snr = Number(opts.get("snr") ?? "10");
      const frames = Number(opts.get("frames") ?? "1");
      const seed = Number(opts.get("seed") ?? "1");
      const cfg = rxConfig(opts);
      const { tx, rx } = Receiver.pair(cfg);
      const noiseVar = snrDbToNoiseVar(snr);
      const channel = new AwgnChannel(seed);
      let totalErrors = 0;
      let totalBits = 0;
      let framesOk = 0;
      for (let f = 0; f < frames; f++) {
        const info = generateInfoBits(tx.K, seed + f);
        const txRes = tx.transmit(info);
        const rxRes = rx.receive(channel.apply(txRes.symbols, noiseVar), noiseVar);
        const errors = countBitErrors(info, rxRes.infoBits);
        totalErrors += errors;
        totalBits += info.length;
        if (rxRes.syndromeOk) framesOk++;
        console.log(
          `frame ${f}: erros=${errors}/${info.length} iteracoes=${rxRes.iterations} sindromeOk=${rxRes.syndromeOk}`,
        );
      }
      console.log(
        `BER=${(totalErrors / totalBits).toExponential(3)} (${totalErrors}/${totalBits}) ` +
          `framesOk=${framesOk}/${frames} snr=${snr}dB mod=${tx.modulation} N=${tx.N} K=${tx.K}`,
      );
      break;
    }

    case "encode": {
      const hex = opts.get("hex");
      if (!hex) throw new Error("encode requer --hex <info>");
      const cfg = rxConfig(opts);
      const tx = new Transmitter(cfg);
      const info = hexToBits(hex);
      if (info.length > tx.K) throw new Error(`info maior que K=${tx.K}`);
      while (info.length < tx.K) info.push(0);
      const r = tx.transmit(info);
      console.log(JSON.stringify({
        codewordHex: bitsToHex(pad8(r.codeword)),
        interleavedHex: bitsToHex(pad8(r.interleaved)),
        symbols: r.symbols,
      }));
      break;
    }

    case "decode": {
      const file = opts.get("symbols");
      if (!file) throw new Error("decode requer --symbols <arquivo.json com array {re,im}>");
      const noiseVar = Number(opts.get("noise-var") ?? "0.01");
      const cfg = rxConfig(opts);
      const rx = new Receiver(cfg);
      const symbols = JSON.parse(await readFile(file, "utf8")) as { re: number; im: number }[];
      const r = rx.receive(symbols, noiseVar);
      console.log(JSON.stringify({
        infoHex: bitsToHex(pad8(r.infoBits)),
        iterations: r.iterations,
        syndromeOk: r.syndromeOk,
      }));
      break;
    }

    case "serve": {
      const port = Number(opts.get("port") ?? "8080");
      const { port: effective } = await startServer(port);
      console.log(`servidor ouvindo em http://127.0.0.1:${effective}`);
      break;
    }

    default:
      console.log(`ldpc-transceiver CLI

Comandos:
  simulate --snr <db> [--mod 16QAM] [--preset qc648|qc1296] [--frames N] [--seed S]
  encode --hex <infoHex> [--mod ...] [--preset ...]
  decode --symbols <arquivo.json> --noise-var <v> [--preset ...]
  serve --port <porta>`);
  }
}

main().catch((err: unknown) => {
  console.error(`erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
