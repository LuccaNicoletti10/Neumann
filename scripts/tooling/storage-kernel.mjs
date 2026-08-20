/**
 * Fail-closed static gate: production src cannot own object/link Maps,
 * dual-write query-api into a KnowledgeGraphStore, or bridge an async
 * repository call back into a synchronous facade (ADR-0013).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const CANONICAL_MEMORY_ADAPTERS = new Set([
  'packages/object-platform/src/core/object-repository.ts',
  'packages/object-platform/src/core/link-repository.ts',
]);

const FORBIDDEN_STORE_PATTERNS = [
  { re: /indexByPk/, why: 'legacy ObjectPlatform PK index' },
  { re: /new Map<\s*OntologyObjectId/, why: 'OntologyObject Map outside adapters' },
  { re: /new Map<\s*GraphObjectId/, why: 'GraphObject Map outside adapters' },
  { re: /new Map<\s*string\s*,\s*OntologyObject/, why: 'OntologyObject Map outside adapters' },
  { re: /new Map<\s*string\s*,\s*LinkInstance/, why: 'LinkInstance Map outside adapters' },
  { re: /new Map<\s*string\s*,\s*TypedLink/, why: 'TypedLink Map outside adapters' },
];

// WHY: a facade that starts a repository call and then throws on detecting a
// Promise has already mutated PostgreSQL — the throw is a lie and the write is
// a ghost. Storage ports are async-only (ADR-0013); no sync bridge may return.
const SYNC_BRIDGE_PATTERNS = [
  { re: /\bsyncValue\s*\(/, why: 'syncValue bridges an async port into a sync facade (ADR-0013)' },
  {
    re: /\bfunction\s+syncValue\b/,
    why: 'syncValue helper is forbidden; storage ports are async-only (ADR-0013)',
  },
  {
    re: /\bfunction\s+isThenable\b/,
    why: 'isThenable branching on a storage port is forbidden (ADR-0013)',
  },
];

const PUBLIC_WRITER_PATTERNS = [
  { re: /\.objects\.(create|update|delete)\s*\(/, why: 'writer on objects from this surface' },
  { re: /\.links\.(create|delete)\s*\(/, why: 'writer on links from this surface' },
];

export function listTsFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === 'tests') continue;
      listTsFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

export function verifyStorageKernel(repoRoot) {
  const errors = [];
  const packagesDir = join(repoRoot, 'packages');
  let pkgEntries = [];
  try {
    pkgEntries = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return { ok: false, errors: ['packages/ missing'] };
  }

  for (const pkg of pkgEntries) {
    if (!pkg.isDirectory()) continue;
    if (pkg.name === 'ontology-registry') {
      const pkgJsonPath = join(packagesDir, pkg.name, 'package.json');
      if (existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pkgJson.dependencies?.['action-engine'] || pkgJson.devDependencies?.['action-engine']) {
          errors.push('packages/ontology-registry/package.json: must not depend on action-engine');
        }
      }
    }
    const srcDir = join(packagesDir, pkg.name, 'src');
    if (!existsSync(srcDir)) continue;
    for (const file of listTsFiles(srcDir)) {
      const rel = relative(repoRoot, file).replaceAll('\\', '/');
      const src = readFileSync(file, 'utf8');

      if (rel.startsWith('packages/query-api/src/') && /from\s+['"]knowledge-graph['"]/.test(src)) {
        errors.push(`${rel}: query-api must not import knowledge-graph (search is a projection)`);
      }

      for (const pat of SYNC_BRIDGE_PATTERNS) {
        if (pat.re.test(src)) {
          errors.push(`${rel}: ${pat.why}`);
        }
      }

      if (!CANONICAL_MEMORY_ADAPTERS.has(rel)) {
        for (const pat of FORBIDDEN_STORE_PATTERNS) {
          if (pat.re.test(src)) {
            errors.push(`${rel}: ${pat.why}`);
          }
        }
      }

      const publicSurface =
        rel.startsWith('packages/platform-api/src/routes/') || rel.startsWith('packages/query-api/src/');
      if (publicSurface) {
        for (const pat of PUBLIC_WRITER_PATTERNS) {
          if (pat.re.test(src)) {
            errors.push(`${rel}: ${pat.why}`);
          }
        }
      }

      if (rel.startsWith('packages/platform-api/src/')) {
        if (/\bcreatePolicyEngine\b/.test(src)) {
          errors.push(`${rel}: second evaluator createPolicyEngine is forbidden (ADR-0009)`);
        }
        if (/\bcreateOntologyAuthorizer\b/.test(src)) {
          errors.push(`${rel}: createOntologyAuthorizer is a fixture compiler, not HTTP authority`);
        }
        if (/\.hydrate\s*\(/.test(src)) {
          errors.push(`${rel}: PolicyEngine.hydrate is not the HTTP bootstrap (ADR-0009)`);
        }
      }

      if (rel.startsWith('packages/ontology-registry/src/') && /from\s+['"]action-engine['"]/.test(src)) {
        errors.push(`${rel}: ontology-registry must not import action-engine`);
      }
    }
  }

  const ingestRoute = join(repoRoot, 'packages/platform-api/src/routes/ingest.ts');
  if (existsSync(ingestRoute)) {
    const src = readFileSync(ingestRoute, 'utf8');
    if (/from\s+['"]object-platform['"]/.test(src) || /(?:import|from)[^\n]*ProjectionWriter/.test(src)) {
      errors.push('packages/platform-api/src/routes/ingest.ts: must not import object-platform or ProjectionWriter');
    }
    if (/ctx\.(objects|links|projections|mappings|mappingVersions)\b/.test(src)) {
      errors.push('packages/platform-api/src/routes/ingest.ts: must not access repositories or ProjectionWriter');
    }
    if (!/await\s+ctx\.ingestion\.enqueueWebhook/.test(src)) {
      errors.push('packages/platform-api/src/routes/ingest.ts: must await enqueueWebhook');
    }
    const awaitIdx = src.indexOf('await ctx.ingestion.enqueueWebhook');
    const acceptedIdx = src.indexOf('code(202)');
    if (awaitIdx < 0 || acceptedIdx < 0 || acceptedIdx < awaitIdx) {
      errors.push('packages/platform-api/src/routes/ingest.ts: 202 must be after enqueueWebhook completes');
    }
  }

  for (const name of ['connector-csv', 'connector-http', 'connector-webhook']) {
    const pkgJsonPath = join(packagesDir, name, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
    if (deps['object-platform'] || deps['platform-api']) {
      errors.push(`packages/${name}/package.json: connector must not depend on object-platform/platform-api`);
    }
  }

  const mappingRepo = join(repoRoot, 'packages/ingestion-runtime/src/core/mapping-version-repository.ts');
  const platformMaps = join(repoRoot, 'packages/object-platform/src/core/platform.ts');
  if (existsSync(mappingRepo) && existsSync(join(repoRoot, 'packages/ingestion-runtime/src/core/runtime.ts'))) {
    const runtimeSrc = readFileSync(join(repoRoot, 'packages/ingestion-runtime/src/core/runtime.ts'), 'utf8');
    if (/createObjectPlatform/.test(runtimeSrc)) {
      errors.push('ingestion-runtime must not construct a second ObjectPlatform mapping catalog');
    }
  }
  void platformMaps;

  const sql0023 = join(repoRoot, 'infra/sql/0023_ingestion_ingress_catalog.sql');
  if (existsSync(sql0023)) {
    const body = readFileSync(sql0023, 'utf8');
    if (!/config \? 'secret'/.test(body)) {
      errors.push('0023 must reject persisted connector config that contains a secret key');
    }
  }
  const connectorCatalog = join(repoRoot, 'packages/ingestion-runtime/src/core/connector-catalog.ts');
  if (existsSync(connectorCatalog)) {
    const src = readFileSync(connectorCatalog, 'utf8');
    if (!/assertConfigHasNoSecret/.test(src)) {
      errors.push('connector catalog must reject secret-bearing config before persist');
    }
  }

  const fnReads = join(repoRoot, 'packages/platform-api/src/core/function-reads.ts');
  const fnContext = join(repoRoot, 'packages/platform-api/src/core/context.ts');
  if (existsSync(fnContext) && /createFunctionRuntime/.test(readFileSync(fnContext, 'utf8'))) {
    if (!existsSync(fnReads)) {
      errors.push('packages/platform-api/src/core/function-reads.ts: Function reads adapter is required');
    } else {
      const src = readFileSync(fnReads, 'utf8');
      if (
        /\bobjects\.get\b/.test(src) ||
        /\bObjectRepository\b/.test(src) ||
        /from\s+['"]pg['"]/.test(src) ||
        /\.query\s*\(/.test(src)
      ) {
        errors.push(
          'packages/platform-api/src/core/function-reads.ts: must not use objects.get, ObjectRepository, or SQL',
        );
      }
      if (!/\.asOf\s*\(/.test(src)) {
        errors.push('packages/platform-api/src/core/function-reads.ts: must read via history.asOf');
      }
    }
    const ctxSrc = readFileSync(fnContext, 'utf8');
    if (/functionReads\(policy,\s*(root\.)?objects\)/.test(ctxSrc)) {
      errors.push('packages/platform-api/src/core/context.ts: Function reads must not take ObjectRepository');
    }
  }
  const fnRuntime = join(repoRoot, 'packages/function-registry/src/core/runtime.ts');
  if (existsSync(fnRuntime)) {
    const src = readFileSync(fnRuntime, 'utf8');
    if (/\bgetLatestVersion\b/.test(src)) {
      errors.push('packages/function-registry/src/core/runtime.ts: execution must not resolve latest');
    }
    if (/ObjectRepository|ProjectionWriter|from\s+['"]pg['"]/.test(src)) {
      errors.push('packages/function-registry/src/core/runtime.ts: must not import repository, SQL, or ProjectionWriter');
    }
    if (/\bobjects\.get\b/.test(src)) {
      errors.push('packages/function-registry/src/core/runtime.ts: must not call objects.get');
    }
    if (/objects:\s*claimed\.objectSnapshot/.test(src)) {
      errors.push('packages/function-registry/src/core/runtime.ts: sandbox must not consume the stored live snapshot');
    }
    if (!/claimed\.readAsOf/.test(src)) {
      errors.push('packages/function-registry/src/core/runtime.ts: sandbox snapshot must reload at claimed.readAsOf');
    }
  }
  const fnResolver = join(repoRoot, 'packages/function-registry/src/core/resolver.ts');
  if (existsSync(fnResolver)) {
    const src = readFileSync(fnResolver, 'utf8');
    if (!/if\s*\(\s*!def\.artifactHash\s*\)/.test(src)) {
      errors.push('packages/function-registry/src/core/resolver.ts: must refuse a FunctionType without artifactHash');
    }
  }
  const fnRoute = join(repoRoot, 'packages/platform-api/src/routes/functions.ts');
  if (existsSync(fnRoute)) {
    const src = readFileSync(fnRoute, 'utf8');
    if (/runInWorker|from\s+['"]execution-sandbox['"]|from\s+['"]object-platform['"]/.test(src)) {
      errors.push('packages/platform-api/src/routes/functions.ts: must not call sandbox or repositories');
    }
    if (/ctx\.(objects|links|projections|sql)\b/.test(src)) {
      errors.push('packages/platform-api/src/routes/functions.ts: must not access repositories or SQL');
    }
  }

  const platformApiSrc = join(repoRoot, 'packages/platform-api/src');
  if (existsSync(platformApiSrc)) {
    for (const file of listTsFiles(platformApiSrc)) {
      const rel = relative(repoRoot, file).replaceAll('\\', '/');
      const src = readFileSync(file, 'utf8');
      if (/\bcreateFunctionRegistry\b/.test(src)) {
        errors.push(`${rel}: process-local Function registry is forbidden on the HTTP path`);
      }
      if (/\bPostgresOutboxStore\b|\bcreatePostgresOutboxStore\b/.test(src)) {
        errors.push(`${rel}: production HTTP path must not import PostgresOutboxStore (use createPgOutboxRepository)`);
      }
      if (/\bfrom\s+['"]query-api['"]/.test(src)) {
        errors.push(`${rel}: platform-api must not import query-api inverted index`);
      }
      if (/\bfunction\s+createSystemClock\b/.test(src) || /\bfunction\s+createUuidIdGenerator\b/.test(src)) {
        errors.push(`${rel}: second Clock/IdGenerator factory is forbidden`);
      }
    }
  }
  const fnSrc = join(repoRoot, 'packages/function-registry/src');
  if (existsSync(fnSrc)) {
    for (const file of listTsFiles(fnSrc)) {
      const rel = relative(repoRoot, file).replaceAll('\\', '/');
      const src = readFileSync(file, 'utf8');
      if (/\bfunction\s+createSystemClock\b/.test(src) || /\bfunction\s+createUuidIdGenerator\b/.test(src)) {
        errors.push(`${rel}: second Clock/IdGenerator factory is forbidden`);
      }
      if (
        /\/core\/(runtime|sandbox-runner|resolver|action-invoker|worker|builtin-artifacts)\.ts$/.test(rel) &&
        (/ObjectRepository|ProjectionWriter/.test(src) || /\bobjects\.get\b/.test(src))
      ) {
        errors.push(`${rel}: Function execution path must not import ObjectRepository, ProjectionWriter, or objects.get`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
