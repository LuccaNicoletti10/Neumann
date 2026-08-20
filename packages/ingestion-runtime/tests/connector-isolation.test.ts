/**
 * ingestion-runtime — connectors never depend on domain packages.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('connector isolation', () => {
  it('CSV, HTTP and webhook depend only on contracts + connector-sdk', () => {
    for (const name of ['connector-csv', 'connector-http', 'connector-webhook']) {
      const pkg = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps.sort()).toEqual(['connector-sdk', 'contracts']);
      expect(deps).not.toContain('object-platform');
      expect(deps).not.toContain('ingestion-runtime');
      expect(deps).not.toContain('ontology-registry');
      expect(deps).not.toContain('policy-engine');
    }
  });
});
