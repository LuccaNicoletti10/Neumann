/**
 * action-engine — src/index.ts
 */

export type {
  CreateActionExecutorOptions,
  Clock,
  IdGenerator,
  ActionTransactionStores,
  ActionUnitOfWork,
} from './core/types.js';
export {
  createActionExecutor,
  createMemoryOperationalEventStore,
  createMemoryActionExecutionStore,
} from './core/executor.js';
export {
  createOntologyActionResolver,
  resolveActionByApiName,
} from './core/action-definition-resolver.js';
export {
  assertActionTransition,
  isTerminalStatus,
  transitionExecution,
} from './core/action-lifecycle.js';
export {
  renderDocumentTemplate,
  templateContextFrom,
} from './core/document-template.js';
export type { TemplateContext } from './core/document-template.js';
export {
  buildParameterTree,
  bindParameterVariable,
  setVariable,
  flattenParameterTree,
  applyDefVariableBindings,
  apiNameOf,
} from './core/parameter-tree.js';
export {
  createActionWorkflowRunner,
  topologicalSteps,
  resolveStepParameters,
  dependentSteps,
  ActionWorkflowError,
} from './core/workflow.js';
export { createPgOperationalEventStore } from './core/pg-events.js';
export type { CreatePgOperationalEventStoreOptions } from './core/pg-events.js';
export { createPgActionExecutionStore } from './core/pg-execution-store.js';
export type { CreatePgActionExecutionStoreOptions } from './core/pg-execution-store.js';
export { createMemoryOutboxRepository } from './core/memory-outbox.js';
export { createFailureSurvivingExecutor } from './core/failure-surviving-executor.js';
export {
  buildActionRequestIdentity,
  serializeCanonicalRequest,
  HASH_VERSION as ACTION_HASH_VERSION,
} from './core/action-request-identity.js';
export { validateActionParameters } from './core/action-parameter-validator.js';
export {
  drainWriteBackToConnector,
  demoMappings,
  demoSourceConnector,
} from './core/writeback-cycle.js';
