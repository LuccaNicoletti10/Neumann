/**
 * Teste do servidor HTTP (node:http) - API da cadeia TX/RX da familia
 * CA3111603: /health, /tx/encode, /rx/decode, /simulate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/server/index.js";
import type { Server } from "node:http";

let server: Server;
let base: string;

beforeAll(async () => {
  const started = await startServer(0); // porta efemera
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("servidor HTTP", () => {
  it("GET /health responde ok", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; presets: string[] };
    expect(json.status).toBe("ok");
    expect(json.presets).toContain("qc648");
  });

  it("POST /simulate faz round-trip completo com BER 0 em SNR alto", async () => {
    const { status, json } = await post("/simulate", {
      snrDb: 12,
      config: { preset: "qc648", modulation: "16QAM", seed: 7 },
    });
    expect(status).toBe(200);
    expect(json.ber).toBe(0);
    expect(json.errors).toBe(0);
    expect(json.syndromeOk).toBe(true);
    expect(typeof json.infoHex).toBe("string");
    expect(json.iterations).toBeGreaterThan(0);
  });

  it("POST /simulate com infoHex do cliente", async () => {
    const { status, json } = await post("/simulate", {
      infoHex: "deadbeef",
      snrDb: 12,
      config: { preset: "qc648" },
    });
    expect(status).toBe(200);
    expect(json.errors).toBe(0);
    // prefixo da informacao decodificada deve ser o enviado (K > 32 bits)
    expect(json.infoHex.startsWith("deadbeef")).toBe(true);
  });

  it("POST /tx/encode seguido de /rx/decode recupera a informacao", async () => {
    const enc = await post("/tx/encode", {
      infoHex: "00ff10",
      config: { preset: "qc648", modulation: "QPSK" },
    });
    expect(enc.status).toBe(200);
    expect(enc.json.symbols.length).toBe(enc.json.N / 2);
    const dec = await post("/rx/decode", {
      symbols: enc.json.symbols,
      noiseVar: 0.000001,
      config: { preset: "qc648", modulation: "QPSK" },
    });
    expect(dec.status).toBe(200);
    expect(dec.json.syndromeOk).toBe(true);
    expect(dec.json.infoHex.startsWith("00ff10")).toBe(true);
  });

  it("erros de validacao retornam 400", async () => {
    const bad1 = await post("/simulate", { config: { preset: "nao-existe" } });
    expect(bad1.status).toBe(400);
    const bad2 = await post("/rx/decode", { symbols: "x", noiseVar: 1 });
    expect(bad2.status).toBe(400);
    const bad3 = await post("/tx/encode", {});
    expect(bad3.status).toBe(400);
  });

  it("rota desconhecida retorna 404", async () => {
    const res = await fetch(`${base}/nada`);
    expect(res.status).toBe(404);
  });
});
