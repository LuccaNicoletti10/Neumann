/**
 * Workspace catalog gate for TypeScript, Vitest, Fastify, and related plugins.
 *
 * Invariant: every workspace `package.json` that lists a catalogued package
 * must use the `catalog:` protocol. Resolved versions from `pnpm list` must
 * be unique per catalogued name unless listed in {@link VERSION_EXCEPTIONS}.
 *
 * @module
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CATALOG_NAMES = [
  'typescript',
  'vitest',
  '@vitest/coverage-v8',
  'fastify',
  '@types/node',
];

/**
 * Documented resolved-version exceptions. Empty after catalog unification;
 * kept as the extension point so a future justified pin is explicit.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const VERSION_EXCEPTIONS = {};

/**
 * @param {string} repoRoot
 * @returns {{ name: string, path: string, json: Record<string, unknown> }[]}
 */
export function listWorkspacePackages(repoRoot) {
  const pkgs = [];
  const rootJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  pkgs.push({ name: String(rootJson.name ?? 'root'), path: '.', json: rootJson });
  for (const base of ['packages', 'apps']) {
    const dir = join(repoRoot, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const pj = join(dir, name, 'package.json');
      if (!existsSync(pj)) continue;
      pkgs.push({
        name,
        path: join(base, name),
        json: JSON.parse(readFileSync(pj, 'utf8')),
      });
    }
  }
  return pkgs;
}

/**
 * @param {Record<string, unknown>} json
 * @param {string} depName
 * @returns {{ field: string, spec: string } | null}
 */
export function findDepSpec(json, depName) {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = json[field];
    if (typeof block !== 'object' || block === null) continue;
    const spec = block[depName];
    if (typeof spec === 'string') return { field, spec };
  }
  return null;
}

/**
 * @typedef {object} CatalogReport
 * @property {boolean} ok
 * @property {string[]} missingCatalogProtocol
 * @property {string[]} missingCoverageProvider
 */

/**
 * @param {string} repoRoot
 * @returns {CatalogReport}
 */
export function verifyCatalogProtocol(repoRoot) {
  const missingCatalogProtocol = [];
  const missingCoverageProvider = [];
  for (const pkg of listWorkspacePackages(repoRoot)) {
    for (const depName of CATALOG_NAMES) {
      const found = findDepSpec(pkg.json, depName);
      if (!found) continue;
      if (found.spec !== 'catalog:') {
        missingCatalogProtocol.push(`${pkg.path} ${found.field} ${depName}=${found.spec}`);
      }
    }
    const vitest = findDepSpec(pkg.json, 'vitest');
    const coverage = findDepSpec(pkg.json, '@vitest/coverage-v8');
    if (pkg.path !== '.' && vitest && !coverage) {
      missingCoverageProvider.push(pkg.path);
    }
  }
  return {
    ok: missingCatalogProtocol.length === 0 && missingCoverageProvider.length === 0,
    missingCatalogProtocol,
    missingCoverageProvider,
  };
}

/**
 * @param {Array<{ name?: string, path?: string, version?: string }>} listItems `pnpm list --json` entries
 * @param {string} depName
 * @returns {{ versions: string[], byPackage: Record<string, string> }}
 */
export function collectResolvedVersions(listItems, depName) {
  const byPackage = {};
  for (const item of listItems) {
    const deps = item;
    const version = readNestedVersion(deps, depName);
    if (version) byPackage[item.path ?? item.name ?? 'unknown'] = version;
  }
  return { versions: [...new Set(Object.values(byPackage))].sort(), byPackage };
}

/**
 * @param {unknown} item
 * @param {string} depName
 * @returns {string | null}
 */
function readNestedVersion(item, depName) {
  if (typeof item !== 'object' || item === null) return null;
  for (const field of ['dependencies', 'devDependencies', 'unsavedDependencies']) {
    const block = item[field];
    if (typeof block !== 'object' || block === null) continue;
    const hit = block[depName];
    if (typeof hit === 'object' && hit !== null && typeof hit.version === 'string') {
      return hit.version;
    }
  }
  return null;
}

/**
 * @param {unknown} pnpmListJson
 * @returns {string[]}
 */
export function divergentResolvedVersions(pnpmListJson) {
  const items = Array.isArray(pnpmListJson) ? pnpmListJson : [];
  const problems = [];
  for (const depName of CATALOG_NAMES) {
    const { versions, byPackage } = collectResolvedVersions(items, depName);
    if (versions.length <= 1) continue;
    const exception = VERSION_EXCEPTIONS[depName];
    if (exception) continue;
    problems.push(
      `${depName} resolved to ${versions.join(', ')} (${Object.entries(byPackage)
        .map(([p, v]) => `${p}@${v}`)
        .join('; ')})`,
    );
  }
  return problems;
}
