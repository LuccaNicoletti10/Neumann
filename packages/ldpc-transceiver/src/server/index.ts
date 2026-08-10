/**
 * ldpc-transceiver - src/server/index.ts
 *
 * Servidor HTTP (somente node:http, zero dependencias de runtime) expondo a
 * cadeia TX/RX da familia CA3111603:
 *   POST /tx/encode  { infoHex?, infoBits?, config? } -> { codewordHex, interleavedHex, symbols }
 *   POST /rx/decode  { symbols, noiseVar, config? }   -> { infoHex, iterations, syndromeOk }
 *   POST /simulate   { infoHex?, infoBits?, snrDb, config? } -> { ber, errors, infoHex, ... }
 *   GET  /health                                            -> { status: "ok" }
 */

import http from "node:http";
import { Receiver, type ReceiverConfig } from "../rx/receiver.js";
import { Transmitter, type TransmitterConfig } from "../tx/transmitter.js";
import { AwgnChannel, snrDbToNoiseVar } from "../channel/awgn.js";
import { generateInfoBits } from "../simulate.js";
import { bitsToHex, countBitErrors, hexToBits } from "../utils/bits.js";
import { LDPC_PRESETS, PRESET_QC648 } from "../fec/ldpc-codec.js";
import type { QamOrder } from "../modem/qam.js";
import type { Complex } from "../modem/qam.js";

/** Config aceita pela API (subconjunto serializavel em JSON). */
export interface ApiConfig {
  preset?: string;
  modulation?: QamOrder;
  groupSize?: number;
  seed?: number;
  maxIterations?: number;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function parseConfig(raw: unknown): ReceiverConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object") throw new Error("config deve ser um objeto");
  const c = raw as Record<string, unknown>;
  const out: ReceiverConfig = {};
  if (c["preset"] !== undefined) {
    if (typeof c["preset"] !== "string" || !LDPC_PRESETS[c["preset"]]) {
      throw new Error(`preset invalido; disponiveis: ${Object.keys(LDPC_PRESETS).join(", ")}`);
    }
    out.preset = c["preset"];
  }
  if (c["modulation"] !== undefined) {
    const mod = c["modulation"];
    if (mod !== "QPSK" && mod !== "16QAM" && mod !== "64QAM" && mod !== "256QAM") {
      throw new Error("modulation invalida (QPSK|16QAM|64QAM|256QAM)");
    }
    out.modulation = mod;
  }
  if (c["groupSize"] !== undefined) {
    if (typeof c["groupSize"] !== "number" || c["groupSize"] <= 0) {
      throw new Error("groupSize deve ser numero > 0");
    }
    out.groupSize = c["groupSize"];
  }
  if (c["seed"] !== undefined) {
    if (typeof c["seed"] !== "number") throw new Error("seed deve ser numero");
    out.seed = c["seed"];
  }
  if (c["maxIterations"] !== undefined) {
    if (typeof c["maxIterations"] !== "number" || c["maxIterations"] <= 0) {
      throw new Error("maxIterations deve ser numero > 0");
    }
    out.maxIterations = c["maxIterations"];
  }
  return out;
}

/** Resolve os bits de informacao da requisicao (infoHex ou infoBits). */
function parseInfoBits(body: Record<string, unknown>, K: number): number[] {
  let bits: number[];
  if (typeof body["infoBits"] === "string") {
    const s = body["infoBits"];
    if (!/^[01]+$/.test(s)) throw new Error("infoBits deve ser string de 0/1");
    bits = [...s].map((ch) => Number(ch));
  } else if (typeof body["infoHex"] === "string") {
    bits = hexToBits(body["infoHex"]);
  } else {
    throw new Error("informe infoHex (hex) ou infoBits (string binaria)");
  }
  if (bits.length > K) {
    throw new Error(`info maior que K=${K} bits (recebido ${bits.length})`);
  }
  // Padding com zeros ate K bits.
  while (bits.length < K) bits.push(0);
  return bits;
}

function parseSymbols(raw: unknown): Complex[] {
  if (!Array.isArray(raw)) throw new Error("symbols deve ser um array de {re, im}");
  return raw.map((s, i) => {
    if (typeof s !== "object" || s === null) throw new Error(`symbols[${i}] invalido`);
    const { re, im } = s as Record<string, unknown>;
    if (typeof re !== "number" || typeof im !== "number") {
      throw new Error(`symbols[${i}]: re/im devem ser numeros`);
    }
    return { re, im };
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body excede o limite"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Cria o servidor HTTP (sem listen). */
export function createServer(): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: msg });
    });
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok", presets: Object.keys(LDPC_PRESETS) });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 404, { error: `rota nao encontrada: ${req.method} ${path}` });
    return;
  }

  const bodyText = await readBody(req);
  let body: Record<string, unknown>;
  try {
    body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch {
    sendJson(res, 400, { error: "JSON invalido" });
    return;
  }

  if (path === "/tx/encode") {
    const cfg = parseConfig(body["config"]);
    const tx = new Transmitter(cfg as TransmitterConfig);
    const info = parseInfoBits(body, tx.K);
    const r = tx.transmit(info);
    sendJson(res, 200, {
      codewordHex: bitsToHex(pad8(r.codeword)),
      interleavedHex: bitsToHex(pad8(r.interleaved)),
      symbols: r.symbols,
      note: "codewordHex/interleavedHex com padding de zeros ate multiplo de 8",
      K: tx.K,
      N: tx.N,
    });
    return;
  }

  if (path === "/rx/decode") {
    const cfg = parseConfig(body["config"]);
    const rx = new Receiver(cfg);
    const symbols = parseSymbols(body["symbols"]);
    const noiseVar = typeof body["noiseVar"] === "number" ? body["noiseVar"] : undefined;
    if (noiseVar === undefined || !(noiseVar > 0)) {
      throw new Error("noiseVar (numero > 0) e' obrigatorio");
    }
    const r = rx.receive(symbols, noiseVar);
    sendJson(res, 200, {
      infoHex: bitsToHex(pad8(r.infoBits)),
      K: r.infoBits.length,
      iterations: r.iterations,
      syndromeOk: r.syndromeOk,
    });
    return;
  }

  if (path === "/simulate") {
    const cfg = parseConfig(body["config"]);
    const snrDb = body["snrDb"];
    if (typeof snrDb !== "number") throw new Error("snrDb (numero) e' obrigatorio");
    const { tx, rx } = Receiver.pair(cfg);
    const info =
      body["infoHex"] !== undefined || body["infoBits"] !== undefined
        ? parseInfoBits(body, tx.K)
        : generateInfoBits(tx.K, cfg.seed ?? 42);
    const noiseVar = snrDbToNoiseVar(snrDb);
    const channel = new AwgnChannel(cfg.seed ?? 1);
    const txRes = tx.transmit(info);
    const rxRes = rx.receive(channel.apply(txRes.symbols, noiseVar), noiseVar);
    const errors = countBitErrors(info, rxRes.infoBits);
    sendJson(res, 200, {
      ber: errors / info.length,
      errors,
      infoHex: bitsToHex(pad8(rxRes.infoBits)),
      K: info.length,
      iterations: rxRes.iterations,
      syndromeOk: rxRes.syndromeOk,
      snrDb,
    });
    return;
  }

  sendJson(res, 404, { error: `rota nao encontrada: POST ${path}` });
}

/** Padding de zeros ate comprimento multiplo de 8 (retorna copia). */
function pad8(bits: number[]): number[] {
  const out = [...bits];
  while (out.length % 8 !== 0) out.push(0);
  return out;
}

/** Sobe o servidor (listen). Retorna a porta efetiva. */
export function startServer(port = 8080, host = "127.0.0.1"): Promise<{ server: http.Server; port: number }> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const effective = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: effective });
    });
  });
}

// Execucao direta: `node dist/server/index.js --port 8080` ou `tsx src/server/index.ts`.
const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const idx = process.argv.indexOf("--port");
  const port = idx >= 0 ? Number(process.argv[idx + 1]) : Number(process.env["PORT"] ?? 8080);
  const { port: effective } = await startServer(port);
  console.log(`ldpc-transceiver server ouvindo em http://127.0.0.1:${effective}`);
  console.log(`preset default: ${PRESET_QC648.N}/${PRESET_QC648.K} (rate ${(PRESET_QC648.K / PRESET_QC648.N).toFixed(3)})`);
}
