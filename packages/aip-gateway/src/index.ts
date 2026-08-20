/**
 * aip-gateway — public surface (ADR-0022 / ADR-0023).
 */

export { createAiGateway, type AiGateway, type CreateAiGatewayOptions } from './core/gateway.js';
export {
  createAiAgent,
  DEFAULT_AGENT_PROFILE,
  type AiAgent,
  type CreateAiAgentOptions,
} from './core/agent.js';
export {
  createToolRegistry,
  registerDefaultReadTools,
  registerProposeTools,
  type AipToolRegistry,
  type AipToolHandler,
} from './core/tool-registry.js';
export { DEFAULT_AIP_PROFILE, resolveProfile, renderSystemPrompt } from './core/context-builder.js';
export { filterAipOutput } from './core/output-filter.js';
export { DEFAULT_AGENT_MACHINE, stateDef, canTransition } from './core/state-machine.js';
export {
  selectIdealExamples,
  formatFewShotBlock,
  hashEmbed,
  type FewShotExample,
} from './core/few-shot.js';
export { createMockLlm, type MockLlmScript } from './adapters/mock-llm.js';
export {
  createOpenAiCompatibleLlm,
  type OpenAiCompatibleOptions,
} from './adapters/openai-compatible.js';
