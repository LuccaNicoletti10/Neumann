/**
 * policy-engine — src/core/ontology-authorizer.ts
 *
 * Fixture compiler: declarative roles → PolicyRuntime overlay.
 * Not an HTTP authority (ADR-0003). Runtime call sites use PolicyRuntime.
 */

export type { OntologyGrant, OverlayOp as PolicyOp } from './policy-overlay.js';
export type { OntologyAuthorizer, OntologyAuthorizerConfig } from './policy-runtime.js';
export {
  createAllowAllTestPolicy,
  createDenyAllAuthorizer,
  createOntologyAuthorizer,
} from './policy-runtime.js';
