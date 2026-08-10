/**
 * ldpc-transceiver - src/index.ts
 *
 * API publica do pacote: transceptor LDPC completo (TX/RX da familia
 * CA3111603 - encoder, interleavers, modulador QAM, demodulador,
 * deinterleavers, decoder BP). Implementacao funcional independente.
 */

export {
  LdpcCodec,
  buildParityCheckMatrix,
  computeSyndrome,
  isCodeword,
  LDPC_PRESETS,
  PRESET_QC1296,
  PRESET_QC648,
  type Bit,
  type DecodeOptions,
  type DecodeResult,
  type LdpcParams,
  type ParityCheckMatrix,
} from "./fec/ldpc-codec.js";
export {
  ParityInterleaver,
  parityDeinterleave,
  parityInterleave,
  type ParityInterleaverConfig,
} from "./fec/parity-interleaver.js";
export {
  DEFAULT_GROUP_SIZE,
  GroupInterleaver,
  defaultPermutation,
  isPermutation,
  type GroupInterleaverConfig,
} from "./fec/group-interleaver.js";
export { BlockInterleaver, type BlockInterleaverConfig } from "./fec/block-interleaver.js";
export {
  bitsPerSymbol,
  demodulateLLR,
  getConstellation,
  hardDecision,
  modulate,
  type Complex,
  type QamMapOptions,
  type QamOrder,
} from "./modem/qam.js";
export {
  Transmitter,
  defaultBlockConfig,
  defaultGroupSize,
  type TransmitResult,
  type TransmitterConfig,
} from "./tx/transmitter.js";
export { Receiver, type ReceiveResult, type ReceiverConfig } from "./rx/receiver.js";
export {
  AwgnChannel,
  BscChannel,
  snrDbToNoiseVar,
} from "./channel/awgn.js";
export {
  generateInfoBits,
  simulateFrame,
  type SimulateOptions,
  type SimulateResult,
} from "./simulate.js";
export { Xorshift32, GaussianRng } from "./utils/prng.js";
export {
  bitsToBytes,
  bitsToHex,
  bytesToBits,
  countBitErrors,
  hexToBits,
  randomBits,
} from "./utils/bits.js";
