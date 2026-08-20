/**
 * platform-api — production fail-closed configuration (ADR-0021).
 */

import type { PlatformContext } from './context.js';

export interface ProductionConfigInput {
  mode: PlatformContext['mode'];
  env?: string;
  databaseUrl?: string | undefined;
  policyFixture?: string | undefined;
  ready: boolean;
  policyDegraded: boolean;
  hasProcessLocalFunctionRegistry?: boolean;
}

/**
 * WHY: production must refuse memory stores, allow-all fixtures, missing DB,
 * degraded policy, and process-local Function registries before serving traffic.
 */
export function assertProductionConfig(input: ProductionConfigInput): void {
  const env = input.env ?? process.env.PLATFORM_ENV ?? process.env.NODE_ENV ?? 'development';
  if (env !== 'production') return;

  if (input.mode !== 'postgres') {
    throw new Error('production refused: PLATFORM_MODE must be postgres (memory context forbidden)');
  }
  if (!input.databaseUrl && !process.env.DATABASE_URL) {
    throw new Error('production refused: DATABASE_URL is required');
  }
  if (input.policyFixture === 'allow-all') {
    throw new Error('production refused: allow-all policy fixture is forbidden');
  }
  if (!input.ready) {
    throw new Error('production refused: platform is not ready');
  }
  if (input.policyDegraded) {
    throw new Error('production refused: policy is degraded');
  }
  if (input.hasProcessLocalFunctionRegistry) {
    throw new Error('production refused: process-local Function registry is forbidden');
  }
}

export function assertPostgresContextForProduction(ctx: PlatformContext): void {
  assertProductionConfig({
    mode: ctx.mode,
    ready: ctx.ready,
    policyDegraded: ctx.policy.degraded(),
    databaseUrl: process.env.DATABASE_URL,
  });
}
