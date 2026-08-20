/**
 * Inheritance graph for workspace tsconfigs.
 *
 * Invariant: every `tsconfig*.json` under `packages/` and `apps/` must
 * eventually extend a root preset, except the SHA-protected webhook island.
 *
 * @module
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { parseJsonc } from './jsonc.mjs';

/** Root presets that may appear at the top of an extends chain. */
export const ROOT_PRESETS = ['tsconfig.base.json', 'tsconfig.node.json'];

/**
 * Paths that must not be forced onto a root preset.
 *
 * WHY: `packages/connector-webhook/tsconfig.json` is SHA-locked; its build
 * file extends it, so the chain cannot reach a preset without editing bytes.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TSCONFIG_ALLOWLIST = {
  'packages/connector-webhook/tsconfig.json':
    'SHA-protected pre-existing config; Prompt 01C must not modify bytes',
  'packages/connector-webhook/tsconfig.build.json':
    'extends the SHA-protected tsconfig.json; reconnecting would require editing the protected file',
};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.turbo', 'build']);

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function walkTsconfigs(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkTsconfigs(full, acc);
    else if (name.startsWith('tsconfig') && name.endsWith('.json')) acc.push(full);
  }
  return acc;
}

/**
 * @param {string} repoRoot
 * @returns {string[]} absolute paths
 */
export function listWorkspaceTsconfigs(repoRoot) {
  const acc = [];
  for (const base of ['packages', 'apps']) {
    const dir = join(repoRoot, base);
    if (existsSync(dir)) walkTsconfigs(dir, acc);
  }
  acc.push(join(repoRoot, 'tsconfig.base.json'));
  acc.push(join(repoRoot, 'tsconfig.node.json'));
  return acc.sort();
}

/**
 * @param {string} fromFile
 * @param {string} extendsSpec
 * @returns {string}
 */
export function resolveExtendsPath(fromFile, extendsSpec) {
  if (extendsSpec.startsWith('.')) return resolve(dirname(fromFile), extendsSpec);
  return resolve(dirname(fromFile), extendsSpec);
}

/**
 * @param {string} repoRoot
 * @param {string} absFile
 * @returns {{ chain: string[], root: string | null, error: string | null }}
 */
export function extendsChain(repoRoot, absFile) {
  const chain = [];
  const seen = new Set();
  let current = absFile;
  while (true) {
    const rel = relative(repoRoot, current);
    if (seen.has(rel)) {
      return { chain, root: null, error: `cycle at ${rel}` };
    }
    seen.add(rel);
    chain.push(rel);
    if (!existsSync(current)) {
      return { chain, root: null, error: `missing ${rel}` };
    }
    let parsed;
    try {
      parsed = parseJsonc(readFileSync(current, 'utf8'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { chain, root: null, error: `parse ${rel}: ${message}` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { chain, root: null, error: `parse ${rel}: not an object` };
    }
    const spec = parsed.extends;
    if (typeof spec !== 'string' || spec.length === 0) {
      const base = rel.split('/').pop() ?? rel;
      return { chain, root: ROOT_PRESETS.includes(base) ? rel : null, error: null };
    }
    current = resolveExtendsPath(current, spec.endsWith('.json') ? spec : `${spec}.json`);
  }
}

/**
 * Options present on a child that duplicate the parent file (not the full
 * resolved chain). Duplicate `module`/`moduleResolution` copies of the base
 * preset are the relevant drift this gate rejects.
 *
 * @param {string} repoRoot
 * @param {string} absFile
 * @returns {string[]} duplicated compilerOption keys
 */
export function duplicatedCompilerKeys(repoRoot, absFile) {
  const rel = relative(repoRoot, absFile);
  if (rel in TSCONFIG_ALLOWLIST) return [];
  let parsed;
  try {
    parsed = parseJsonc(readFileSync(absFile, 'utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const spec = parsed.extends;
  if (typeof spec !== 'string' || spec.length === 0) return [];
  const parentPath = resolveExtendsPath(absFile, spec.endsWith('.json') ? spec : `${spec}.json`);
  if (!existsSync(parentPath)) return [];
  let parent;
  try {
    parent = parseJsonc(readFileSync(parentPath, 'utf8'));
  } catch {
    return [];
  }
  const childOpts =
    typeof parsed.compilerOptions === 'object' && parsed.compilerOptions !== null
      ? parsed.compilerOptions
      : {};
  const parentOpts =
    typeof parent.compilerOptions === 'object' && parent.compilerOptions !== null
      ? parent.compilerOptions
      : {};
  const dup = [];
  for (const key of Object.keys(childOpts)) {
    if (!(key in parentOpts)) continue;
    if (JSON.stringify(childOpts[key]) === JSON.stringify(parentOpts[key])) dup.push(key);
  }
  return dup.sort();
}

/**
 * @typedef {object} TsconfigGraphReport
 * @property {boolean} ok
 * @property {string[]} disconnected
 * @property {Array<{ file: string, keys: string[] }>} duplicates
 * @property {string[]} errors
 * @property {Array<{ file: string, chain: string[] }>} chains
 */

/**
 * @param {string} repoRoot
 * @returns {TsconfigGraphReport}
 */
export function verifyTsconfigGraph(repoRoot) {
  const files = listWorkspaceTsconfigs(repoRoot);
  const disconnected = [];
  const duplicates = [];
  const errors = [];
  const chains = [];

  for (const abs of files) {
    const rel = relative(repoRoot, abs);
    const result = extendsChain(repoRoot, abs);
    chains.push({ file: rel, chain: result.chain });
    if (result.error) {
      errors.push(`${rel}: ${result.error}`);
      continue;
    }
    const baseName = rel.split('/').pop() ?? rel;
    if (ROOT_PRESETS.includes(baseName) && result.chain.length === 1) continue;
    if (rel in TSCONFIG_ALLOWLIST) continue;
    if (result.root === null) disconnected.push(rel);
    const dup = duplicatedCompilerKeys(repoRoot, abs);
    if (dup.length > 0) duplicates.push({ file: rel, keys: dup });
  }

  return {
    ok: disconnected.length === 0 && duplicates.length === 0 && errors.length === 0,
    disconnected: disconnected.sort(),
    duplicates,
    errors,
    chains,
  };
}
