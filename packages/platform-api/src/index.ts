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
export { createPlatformServer, type CreatePlatformServerOptions } from './server.js';
export {
  createHmacTokenVerifier,
  signDevToken,
  AuthenticationError,
  type TokenVerifier,
  type VerifiedPrincipal,
} from './core/token-verifier.js';
