import { listenErpSimulator } from './server.js';

const port = Number(process.env.PORT ?? 8090);
const { url } = await listenErpSimulator({ port, host: '0.0.0.0' });
console.log(`Neumann ERP simulator (fake sink) listening on ${url}`);
