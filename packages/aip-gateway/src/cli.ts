/**
 * aip-gateway — CLI demo (memory reader + MockLlm).
 */
import {
  createAiGateway,
  createMockLlm,
} from './index.js';
import type { AipObjectReader } from 'contracts';

async function main(argv: string[]): Promise<number> {
  // pnpm filter passes `--` as argv[2]; skip it.
  const args = argv.slice(2).filter((a) => a !== '--');
  const cmd = args[0] ?? 'help';
  if (cmd === 'help' || cmd === '--help') {
    console.log('Usage: aip -- ask | demo');
    return 0;
  }
  if (cmd === 'ask' || cmd === 'demo') {
    const reads = demoReads();
    const llm = createMockLlm({
      script: {
        kind: 'tools',
        calls: [
          {
            toolId: 'get_object',
            arguments: { objectTypeId: 'ot.item', primaryKey: 'A1' },
          },
        ],
        thenText: 'Item A1 has name Widget (grounded).',
      },
    });
    const gateway = createAiGateway({ reads, llm });
    const res = await gateway.ask({
      ontologyId: 'onto-demo',
      principal: 'demo-user',
      message: 'What is item A1?',
    });
    console.log(JSON.stringify(res, null, 2));
    return 0;
  }
  console.error(`unknown command: ${cmd}`);
  return 1;
}

function demoReads(): AipObjectReader {
  return {
    async listObjectTypes() {
      return ['ot.item'];
    },
    async getObject(_p, _o, objectTypeId, primaryKey) {
      if (objectTypeId === 'ot.item' && primaryKey === 'A1') {
        return {
          objectTypeId,
          primaryKey,
          properties: { name: 'Widget' },
        };
      }
      return undefined;
    },
    async loadObjectSet() {
      return [
        {
          objectTypeId: 'ot.item',
          primaryKey: 'A1',
          properties: { name: 'Widget' },
        },
      ];
    },
    async graphNeighbors() {
      return [];
    },
  };
}

const code = await main(process.argv);
process.exitCode = code;
