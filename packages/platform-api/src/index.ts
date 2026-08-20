/**
 * platform-api — src/index.ts
 */

export {
  createPlatformContext,
  createMemoryPlatformContext,
  createPostgresPlatformContext,
  type PlatformContext,
  type PublicPlatformContext,
  type ObjectReader,
  type LinkReader,
  type PolicyFixtureName,
} from './core/context.js';
export { createPlatformRuntime, type PlatformRuntimeHandle } from './core/bootstrap.js';
export { registerV2Routes } from './routes/v2.js';
export { registerIngestRoutes } from './routes/ingest.js';
export { registerErRoutes } from './routes/er.js';
export { registerFunctionRoutes } from './routes/functions.js';
export { registerAipRoutes } from './routes/aip.js';
export {
  createSecuredReads,
  ReadForbiddenError,
} from './core/secured-reads.js';
export { createPlatformServer, type CreatePlatformServerOptions } from './server.js';
export {
  assertProductionConfig,
  assertPostgresContextForProduction,
  type ProductionConfigInput,
} from './core/assert-production-config.js';
export {
  createHmacTokenVerifier,
  createHs256Verifier,
  signDevToken,
  AuthenticationError,
  type TokenVerifier,
  type VerifiedPrincipal,
} from './core/token-verifier.js';
export {
  createJwksProvider,
  type IdentityProvider,
  type AuthEventSink,
} from './auth/jwks-provider.js';
