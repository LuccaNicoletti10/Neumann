#!/usr/bin/env node
/**
 * function-registry — src/cli.ts
 * demo: scoreRecord / aggregateMetrics / deriveFlags — puras, versionadas.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FunctionObjectInput } from 'contracts';

import { createFunctionRegistry } from './core/registry.js';

const USAGE = `function-registry (fn) — PASSO 23: f(objects) → result (pura, versionada)
  Camada cinética das Dynamic Ontology patents (Passo 17)

Uso:
  fn demo
`;

export interface CliDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const OBJECTS: FunctionObjectInput[] = [
  {
    objectTypeId: 'ot.customer',
    primaryKey: 'A',
    properties: { name: 'ACME LTDA', amount: 80 },
  },
  {
    objectTypeId: 'ot.customer',
    primaryKey: 'B',
    properties: { name: '', amount: 20 },
  },
];

export function runDemo(log: (message: string) => void = console.log): number {
  const fn = createFunctionRegistry();

  log('== 1. registry builtins ==');
  const listed = fn.list();
  log(`  functions=${listed.map((d) => `${d.apiName}@${d.version}`).join(',')}`);

  log('== 2. invoke scoreRecord ==');
  const scored = fn.invoke({ functionId: 'scoreRecord', objects: OBJECTS });
  log(`  version=${scored.version} kind=${scored.outputKind}`);
  const scores = (scored.result as { scores: Array<{ primaryKey?: string; score: number }> }).scores;
  for (const s of scores) {
    log(`  ${s.primaryKey} score=${s.score.toFixed(4)}`);
  }

  log('== 3. aggregateMetrics + deriveFlags ==');
  const metrics = fn.invoke({
    functionId: 'aggregateMetrics',
    objects: OBJECTS,
    params: { property: 'amount' },
  });
  const flags = fn.invoke({
    functionId: 'deriveFlags',
    objects: OBJECTS,
    params: { threshold: 50 },
  });
  const m = metrics.result as { sum: number; avg: number; count: number };
  log(`  metrics count=${m.count} sum=${m.sum} avg=${m.avg}`);
  const f = flags.result as { flags: Array<{ primaryKey?: string; aboveThreshold: boolean }> };
  log(`  flags aboveThreshold=[${f.flags.map((x) => `${x.primaryKey}:${x.aboveThreshold}`).join(',')}]`);

  log('== 4. versionamento imutável ==');
  fn.register(
    {
      id: 'fn.scoreRecord',
      apiName: 'scoreRecord',
      displayName: 'scoreRecord',
      version: '2',
      inputObjectTypeIds: ['ot.customer', 'ot.record', 'ot.entity'],
      outputKind: 'score',
    },
    () => ({ scores: OBJECTS.map((o) => ({ primaryKey: o.primaryKey, score: 0 })) }),
  );
  const v1 = fn.invoke({ functionId: 'scoreRecord', version: '1', objects: OBJECTS });
  const v2 = fn.invoke({ functionId: 'scoreRecord', objects: OBJECTS });
  const v1Score = (v1.result as { scores: Array<{ score: number }> }).scores[0]?.score ?? -1;
  const v2Score = (v2.result as { scores: Array<{ score: number }> }).scores[0]?.score ?? -1;
  log(`  v1.score=${v1Score} latest(v2).score=${v2Score} versions=${fn.listVersions('scoreRecord').map((d) => d.version).join(',')}`);

  log('== 5. pureza: mutação rejeitada ==');
  fn.register(
    {
      id: 'fn.mutate',
      apiName: 'mutate',
      displayName: 'mutate',
      version: '1',
      inputObjectTypeIds: ['ot.customer'],
      outputKind: 'json',
    },
    (objects) => {
      const first = objects[0];
      if (!first) return { ok: false };
      first.properties.hacked = true;
      return { ok: true };
    },
  );
  let purityOk = false;
  try {
    fn.invoke({ functionId: 'mutate', objects: structuredClone(OBJECTS) });
  } catch (err) {
    purityOk = err instanceof Error && /pura|mutação/.test(err.message);
  }
  const originalsIntact = OBJECTS[0]?.properties.hacked === undefined;

  let immutableVersion = false;
  try {
    fn.register(
      {
        id: 'fn.scoreRecord',
        apiName: 'scoreRecord',
        displayName: 'scoreRecord',
        version: '1',
        inputObjectTypeIds: ['ot.customer'],
        outputKind: 'score',
      },
      () => ({ scores: [] }),
    );
  } catch {
    immutableVersion = true;
  }

  const ok =
    listed.length >= 3 &&
    scores.length === 2 &&
    (scores[0]?.score ?? 0) > (scores[1]?.score ?? 1) &&
    m.sum === 100 &&
    v1Score !== v2Score &&
    v2.version === '2' &&
    v1.version === '1' &&
    purityOk &&
    originalsIntact &&
    immutableVersion;

  log(ok ? 'demo ok — function pura, versionada, invocável' : 'demo FAIL');
  return ok ? 0 : 1;
}

export async function runCommandLine(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const args = argv.filter((a) => a !== '--');
  const [cmd] = args;

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return 0;
  }
  if (cmd === 'demo') return runDemo(log);
  error(`comando desconhecido: ${cmd}`);
  log(USAGE);
  return 1;
}

function isMain(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  void runCommandLine(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
