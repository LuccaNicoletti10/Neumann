import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseJsonc } from './jsonc.mjs';
import {
  TSCONFIG_ALLOWLIST,
  duplicatedCompilerKeys,
  extendsChain,
  verifyTsconfigGraph,
} from './tsconfig-graph.mjs';

describe('parseJsonc', () => {
  it('does not treat recursive src globs as block comments', () => {
    const parsed = parseJsonc('{"include": ["src/**/*", "tests/**/*.ts"]}');
    assert.deepEqual(parsed.include, ['src/**/*', 'tests/**/*.ts']);
  });

  it('strips line and block comments outside strings', () => {
    const parsed = parseJsonc(`{
      // WHY: local
      "extends": "../../tsconfig.node.json",
      "compilerOptions": {
        /* keep false */
        "noEmit": true
      }
    }`);
    assert.equal(parsed.extends, '../../tsconfig.node.json');
    assert.equal(parsed.compilerOptions.noEmit, true);
  });
});

describe('tsconfig-graph', () => {
  it('allowlists the SHA-protected webhook island', () => {
    assert.ok('packages/connector-webhook/tsconfig.json' in TSCONFIG_ALLOWLIST);
    assert.ok('packages/connector-webhook/tsconfig.build.json' in TSCONFIG_ALLOWLIST);
  });

  it('rejects a disconnected package tsconfig', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-tsgraph-'));
    mkdirSync(join(root, 'packages', 'orphan'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    writeFileSync(join(root, 'tsconfig.node.json'), JSON.stringify({ extends: './tsconfig.base.json' }));
    writeFileSync(
      join(root, 'packages', 'orphan', 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    const report = verifyTsconfigGraph(root);
    assert.equal(report.ok, false);
    assert.deepEqual(report.disconnected, ['packages/orphan/tsconfig.json']);
  });

  it('accepts a package that extends the node preset', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-tsgraph-'));
    mkdirSync(join(root, 'packages', 'ok'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    writeFileSync(join(root, 'tsconfig.node.json'), JSON.stringify({ extends: './tsconfig.base.json' }));
    writeFileSync(
      join(root, 'packages', 'ok', 'tsconfig.json'),
      JSON.stringify({ extends: '../../tsconfig.node.json', include: ['src'] }),
    );
    const report = verifyTsconfigGraph(root);
    assert.equal(report.ok, true);
    const chain = extendsChain(root, join(root, 'packages', 'ok', 'tsconfig.json'));
    assert.deepEqual(chain.chain, [
      'packages/ok/tsconfig.json',
      'tsconfig.node.json',
      'tsconfig.base.json',
    ]);
  });

  it('flags compilerOptions that duplicate the parent', () => {
    const root = mkdtempSync(join(tmpdir(), 'neumann-tsgraph-'));
    mkdirSync(join(root, 'packages', 'dup'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'dup', 'parent.json'),
      JSON.stringify({ compilerOptions: { strict: true, module: 'NodeNext' } }),
    );
    const child = join(root, 'packages', 'dup', 'tsconfig.json');
    writeFileSync(
      child,
      JSON.stringify({
        extends: './parent.json',
        compilerOptions: { strict: true, outDir: 'dist' },
      }),
    );
    assert.deepEqual(duplicatedCompilerKeys(root, child), ['strict']);
  });
});
