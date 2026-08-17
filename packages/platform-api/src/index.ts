/**
 * platform-api — src/index.ts
 */

export {
  createPlatformContext,
  createMemoryPlatformContext,
  createPostgresPlatformContext,
  type PlatformContext,
} from './core/context.js';
export { registerV2Routes } from './routes/v2.js';
export { registerErRoutes } from './routes/er.js';
export { registerFunctionRoutes } from './routes/functions.js';
export {
  createSecuredReads,
  ReadForbiddenError,
} from './core/secured-reads.js';
export { createPlatformServer, type CreatePlatformServerOptions } from './server.js';
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
