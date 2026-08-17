/**
 * edge-control — src/index.ts
 */

export { createMemoryEdgeConnector, type MemoryEdgeConnector, type EdgeRecordInput } from './core/connector.js';
export {
  createBaseline,
  createBaselineStore,
  type BaselineStore,
} from './core/baseline.js';
export { activityFromEventPayload, detectAnomalies, hourUtc } from './core/detect.js';
export { buildTransmission } from './core/transmit.js';
export { createEdgeControlServer, type EdgeControlServer } from './core/server.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
