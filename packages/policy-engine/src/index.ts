/**
 * policy-engine — src/index.ts
 */

export * from './core/types.js';
export * from './core/determinism.js';
export * from './core/hash.js';
export * from './core/audit.js';
export * from './core/engine.js';
export * from './core/ontology-authorizer.js';
export * from './core/policy-store.js';
export * from './core/policy-overlay.js';
export * from './core/policy-catalog.js';
export * from './core/policy-compiler.js';
export {
  createPolicyRuntime,
  createPolicyRuntimeFromOverlay,
  createAllowAllTestPolicy,
  createDenyAllAuthorizer,
  createOntologyAuthorizer,
  type PolicyRuntime,
  type PolicyRuntimeBundle,
  type PolicyAdmin,
  type CreatePolicyRuntimeOptions,
  type OverlayRuntimeOptions,
} from './core/policy-runtime.js';
export * from './core/resource-ids.js';
export { runClassificationPipeline } from './core/classification-pipeline.js';
export type { ClassifyDemoResult } from './core/classification-pipeline.js';
export { runRedactionPipeline } from './core/redaction-pipeline.js';
export type { RedactDemoResult } from './core/redaction-pipeline.js';
export { createPrincipalCache } from './core/principal-cache.js';
export type { PrincipalCache } from './core/principal-cache.js';
export { redactLogValue, sanitizeLogLine, logFingerprint } from './core/log-redact.js';
export { embedAuthorized, completeAuthorized } from './core/closed-channels.js';
export { runNoninterferenceSuite, probePrincipal, seedWorld, NI_SECRET } from './core/noninterference.js';
export { runAuthzFuzz, oracleAuthorize, mulberry32 } from './core/authz-fuzzer.js';
export type { RunAuthzFuzzOptions, FuzzOracleRow, FuzzResourceRow } from './core/authz-fuzzer.js';
export { createPgPolicyStore } from './core/pg-policy-store.js';
export type { CreatePgPolicyStoreOptions } from './core/pg-policy-store.js';
export { runCommandLine, runDemo, runClassifyDemo, runRedactDemo, runNoninterferenceDemo } from './cli.js';
export type { CliDeps } from './cli.js';
