/**
 * platform-api — src/cli.ts
 */

import { createOntologyAuthorizer } from 'policy-engine';

import {
  createMemoryPlatformContext,
  createPostgresPlatformContext,
} from './core/context.js';
import { createPlatformServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);

const authz = createOntologyAuthorizer({
  roles: {
    lucca: ['admin'],
    'svc-projector': ['servico'],
    'svc-migration': ['servico'],
  },
  grants: [
    { role: 'admin', objectTypes: ['*'], actions: ['*'], operations: ['read', 'modify'] },
    { role: 'servico', objectTypes: ['*'], actions: ['*'], operations: ['read', 'modify'] },
  ],
});

const ctx =
  process.env.PLATFORM_MODE === 'postgres'
    ? createPostgresPlatformContext({
        databaseUrl: process.env.DATABASE_URL,
        authorize: authz.authorize,
        authorizer: authz,
      })
    : createMemoryPlatformContext({
        authorize: authz.authorize,
        authorizer: authz,
        deterministic: false,
      });

const { app } = await createPlatformServer(ctx);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Neumann platform-api listening on :${port} (${ctx.mode})`);
