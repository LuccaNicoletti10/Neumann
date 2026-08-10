Node 20+, TypeScript 5.x strict (noUncheckedIndexedAccess,
noImplicitOverride), "type": "module", moduleResolution: NodeNext.
Testes com vitest (única dependência de desenvolvimento
além de typescript, tsx, @types/node). Nenhuma dependência de runtime.
Todo o "aleatório" usa PRNG próprio com seed (xorshift32 / Box-Muller) —
testes 100% determinísticos.
Stack
preset	N	K	rate ≈	Z	construção
qc648	648	518	4/5 (12/15)	27	QC, coluna-regular dv=3, dual-diagonal
qc1296	1296	648	1/2	27	idem
Códigos LDPC (presets)
import { Receiver, AwgnChannel, snrDbToNoiseVar, generateInfoBits } from "ldpc-transceiver";

const { tx, rx } = Receiver.pair({ preset: "qc648", modulation: "16QAM" });
const info = generateInfoBits(tx.K, 42);           // K bits de informação
const { symbols } = tx.transmit(info);             // cadeia TX completa
const noiseVar = snrDbToNoiseVar(12);              // 12 dB (Es/N0)
const received = new AwgnChannel(1).apply(symbols, noiseVar);
const res = rx.receive(received, noiseVar);        // { infoBits, iterations, syndromeOk, ... }
Uso (biblioteca)
npm run build
node dist/cli.js simulate --snr 12 --mod 16QAM --preset qc648 --frames 5
node dist/cli.js encode --hex deadbeef
node dist/cli.js decode --symbols symbols.json --noise-var 0.0001
node dist/cli.js serve --port 8080
# ou, sem build: npm run cli -- simulate --snr 12
CLI
GET /health → { status: "ok", presets: [...] }
POST /tx/encode { infoHex, config? } → { codewordHex, interleavedHex, symbols }
POST /rx/decode { symbols, noiseVar, config? } → { infoHex, iterations, syndromeOk }
POST /simulate { infoHex?, snrDb, config? } → { ber, errors, infoHex, iterations, syndromeOk }
API HTTP (somente node:http)
npm run build — tsc -p tsconfig.build.json (emite em dist/)
npm test — vitest (64 testes: codec, interleavers, QAM, e2e, servidor)
npm run typecheck — tsc --noEmit sobre src + tests
npm run cli / npm run serve — via tsx, sem build
Scripts
src/
  fec/ldpc-codec.ts          matriz QC-LDPC, encoder sistemático, decoder BP
  fec/parity-interleaver.ts  interleava só a paridade (grupos de Z bits)
  fec/group-interleaver.ts   Y_j = X_pi(j), pi determinística ou custom
  fec/block-interleaver.ts   2 partes, escrita em coluna / leitura em linha
  modem/qam.ts               QPSK/16/64/256QAM Gray, energia 1, LLR log-MAP
  tx/transmitter.ts          pipeline TX
  rx/receiver.ts             pipeline RX (espelha o TX)
  channel/awgn.ts            AWGN (Box-Muller com seed) e BSC
  server/index.ts            HTTP API (node:http)
  cli.ts                     CLI
  utils/prng.ts, bits.ts     xorshift32/gaussiana, hex<->bits
tests/                       vitest
Estrutura
ldpc-transceiver
