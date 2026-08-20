/**
 * ai-gateway — public surface (ADR-0022 / Passo 35).
 */

export {
  createAiGateway,
  type AiGateway,
} from './core/gateway.js';
export {
  createAgentRuntime,
  type AgentRuntime,
} from './core/agent-runtime.js';
export {
  createToolRegistry,
  ToolRegistryError,
  type ToolRegistry,
  type ToolHandler,
} from './core/tool-registry.js';
export {
  createMemoryAiReadPort,
  citationFromView,
  type AiReadPort,
  type AiObjectView,
} from './core/read-port.js';
export {
  registerReadTools,
  LIST_OBJECT_TYPES,
  GET_OBJECT,
  LIST_OBJECTS,
} from './core/read-tools.js';
export {
  collectEvidenceCitations,
  filterGroundedAnswer,
} from './core/output-filter.js';
export {
  createScriptedLlmProvider,
  createHeuristicLlmProvider,
  type ScriptedTurn,
} from './core/llm-provider.js';
export { runCommandLine, runDemo } from './cli.js';
export type { CliDeps } from './cli.js';
