/**
 * platform-api — src/cli.ts
 */

import { createPlatformServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);

const { app } = await createPlatformServer();
await app.listen({ port, host: '0.0.0.0' });
console.log(`Neumann platform-api listening on :${port}`);
