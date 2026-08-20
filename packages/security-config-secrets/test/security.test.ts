import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parseVersion, compareVersions, satisfiesRange } from '../src/security/semver.js';
import { DependencyInventory } from '../src/security/dependency-inventory.js';
import { AdvisoryDatabase } from '../src/security/advisory-db.js';
import { VulnerabilityScanner } from '../src/security/scanner.js';
import { PolicyGate, securityPolicySchema } from '../src/security/policy-gate.js';
import { SuppressionStore } from '../src/security/suppressions.js';
import { SecurityReport } from '../src/security/report.js';
import { ConfigIndexer } from '../src/env-config/config-indexer.js';
import { ChangeComputer, applyInstructions } from '../src/env-config/change-computer.js';
import {
  ConfigServer,
  VersionConflictError,
} from '../src/env-config/config-service.js';
import { GuiGenerator } from '../src/env-config/gui-generator.js';
import { AgeLikeCrypto } from '../src/secrets/legacy/age-crypto-legacy.js';
import { AgeBackend } from '../src/secrets/age-backend.js';
import { migrateSecretsFile } from '../src/secrets/migrate.js';
import { SecretsManager } from '../src/secrets/secrets-manager.js';
import { RepoLayoutGuard } from '../src/secrets/layout-guard.js';
import { main } from '../src/cli.js';
import { buildServer } from '../src/server/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const sampleLock = join(pkgRoot, 'fixtures/sample-lock.json');
const sampleAdvisories = join(pkgRoot, 'advisories/sample.json');
const cleanRepo = join(pkgRoot, 'fixtures/sample-repo');
const dirtyRepo = join(pkgRoot, 'fixtures/sample-repo-dirty');

describe('semver', () => {
  it('parseVersion handles full and partial versions', () => {
    expect(parseVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    expect(parseVersion('v2.0')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: [],
    });
    expect(parseVersion('invalid')).toBeNull();
  });

  it('compareVersions orders semver correctly', () => {
    const a = parseVersion('1.2.3')!;
    const b = parseVersion('1.2.4')!;
    const c = parseVersion('1.2.3')!;
    expect(compareVersions(a, b)).toBe(-1);
    expect(compareVersions(b, a)).toBe(1);
    expect(compareVersions(a, c)).toBe(0);
  });

  it('satisfiesRange supports >=, <, ||, and 1.x', () => {
    expect(satisfiesRange('1.2.3', '>=1.0.0')).toBe(true);
    expect(satisfiesRange('0.9.0', '>=1.0.0')).toBe(false);
    expect(satisfiesRange('1.3.0', '<2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '<2.0.0')).toBe(false);
    expect(satisfiesRange('1.4.1', '< 1.4.2 || >= 2.0.0 < 2.1.0')).toBe(true);
    expect(satisfiesRange('2.0.5', '< 1.4.2 || >= 2.0.0 < 2.1.0')).toBe(true);
    expect(satisfiesRange('1.5.0', '< 1.4.2 || >= 2.0.0 < 2.1.0')).toBe(false);
    expect(satisfiesRange('1.2.9', '1.x')).toBe(true);
    expect(satisfiesRange('2.0.0', '1.x')).toBe(false);
  });
});

describe('DependencyInventory', () => {
  it('fromLockfileText parses lockfileVersion 3', () => {
    const text = readFileSync(sampleLock, 'utf8');
    const inv = DependencyInventory.fromLockfileText(text);
    expect(inv.dependencies.some((d) => d.name === 'lodash' && d.version === '4.17.20')).toBe(true);
    expect(inv.direct.some((d) => d.name === 'lodash')).toBe(true);
  });
});

describe('AdvisoryDatabase + VulnerabilityScanner', () => {
  it('match and scan produce findings for lodash', () => {
    const text = readFileSync(sampleLock, 'utf8');
    const inv = DependencyInventory.fromLockfileText(text);
    const db = AdvisoryDatabase.fromFile(sampleAdvisories);
    const lodash = inv.dependencies.find((d) => d.name === 'lodash')!;
    const matched = db.match(lodash);
    expect(matched.length).toBeGreaterThanOrEqual(2);

    const scanner = new VulnerabilityScanner(db);
    const findings = scanner.scan(inv);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.severity === 'critical')).toBe(true);
    expect(findings.some((f) => f.severity === 'high')).toBe(true);
  });
});

describe('PolicyGate', () => {
  it('fails on high/critical findings at fail-on high', () => {
    const text = readFileSync(sampleLock, 'utf8');
    const inv = DependencyInventory.fromLockfileText(text);
    const db = AdvisoryDatabase.fromFile(sampleAdvisories);
    const findings = new VulnerabilityScanner(db).scan(inv);
    const gate = new PolicyGate(securityPolicySchema.parse({ failOnSeverity: 'high' }));
    const result = gate.evaluate(findings);
    expect(result.decision).toBe('fail');
    expect(result.reasons.some((r) => r.includes('HIGH') || r.includes('CRITICAL'))).toBe(true);
  });

  it('passes when only moderate findings at fail-on high', () => {
    const dep = {
      name: 'pkg',
      version: '1.0.0',
      ecosystem: 'npm' as const,
      kind: 'direct' as const,
    };
    const db = AdvisoryDatabase.fromAdvisories([
      {
        id: 'MOD-1',
        packageName: 'pkg',
        affectedRanges: ['>=1.0.0'],
        severity: 'moderate',
        title: 'Moderate issue',
      },
    ]);
    const findings = new VulnerabilityScanner(db).scan({
      dependencies: [dep],
    } as DependencyInventory);
    const gate = new PolicyGate(securityPolicySchema.parse({ failOnSeverity: 'high' }));
    const result = gate.evaluate(findings);
    expect(result.decision).toBe('pass');
  });

  it('expired suppressions no longer suppress findings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'passo03-sup-'));
    const supFile = join(tmp, 'suppressions.json');
    const auditFile = supFile + '.audit.jsonl';
    try {
      const dep = {
        name: 'lodash',
        version: '4.17.20',
        ecosystem: 'npm' as const,
        kind: 'direct' as const,
      };
      const advisory = {
        id: 'GHSA-test',
        packageName: 'lodash',
        affectedRanges: ['4.17.20'],
        severity: 'critical' as const,
        title: 'Test advisory',
      };
      const finding = { advisory, dependency: dep, severity: 'critical' as const };
      const store = new SuppressionStore(supFile, auditFile);
      const past = new Date('2020-01-01T00:00:00Z');
      store.add(
        {
          advisoryId: 'GHSA-test',
          packageName: 'lodash',
          reason: 'temp',
          expiresAt: '2020-06-01T00:00:00Z',
          approvedBy: 'tester',
        },
        'tester',
        past,
      );
      expect(store.lookup(finding, 'ci', new Date('2025-01-01T00:00:00Z'))).toBeNull();

      const gate = new PolicyGate(securityPolicySchema.parse({ failOnSeverity: 'high' }), store);
      const result = gate.evaluate([finding], new Date('2025-01-01T00:00:00Z'));
      expect(result.decision).toBe('fail');
      expect(result.suppressed).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('active suppressions allow gate to pass', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'passo03-sup2-'));
    const supFile = join(tmp, 'suppressions.json');
    const auditFile = supFile + '.audit.jsonl';
    try {
      const text = readFileSync(sampleLock, 'utf8');
      const inv = DependencyInventory.fromLockfileText(text);
      const db = AdvisoryDatabase.fromFile(sampleAdvisories);
      const findings = new VulnerabilityScanner(db).scan(inv);
      const store = new SuppressionStore(supFile, auditFile);
      const now = new Date('2026-01-01T00:00:00Z');
      for (const f of findings) {
        store.add(
          {
            advisoryId: f.advisory.id,
            packageName: f.dependency.name,
            reason: 'accepted risk',
            expiresAt: '2027-01-01T00:00:00Z',
            approvedBy: 'lead',
          },
          'lead',
          now,
        );
      }
      const gate = new PolicyGate(securityPolicySchema.parse({ failOnSeverity: 'high' }), store);
      const result = gate.evaluate(findings, now);
      expect(result.decision).toBe('pass');
      expect(result.suppressed).toBe(findings.length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('SecurityReport', () => {
  it('toText and toJson include findings and gate', () => {
    const text = readFileSync(sampleLock, 'utf8');
    const inv = DependencyInventory.fromLockfileText(text);
    const db = AdvisoryDatabase.fromFile(sampleAdvisories);
    const findings = new VulnerabilityScanner(db).scan(inv);
    const gate = new PolicyGate(securityPolicySchema.parse({ failOnSeverity: 'high' }));
    const result = gate.evaluate(findings);
    const report = new SecurityReport(findings, result);

    const json = report.toJson();
    expect(json.totals.all).toBeGreaterThan(0);
    expect(json.gate?.decision).toBe('fail');
    expect(json.findings[0]?.package).toBe('lodash');

    const txt = report.toText();
    expect(txt).toContain('Relatorio de seguranca');
    expect(txt).toContain('lodash');
    expect(txt).toContain('Gate: FAIL');
  });
});

describe('ConfigIndexer + ChangeComputer', () => {
  it('surgical edit preserves comments and formatting', () => {
    const configText = `{
  // porta da API
  "port": 8080,
  "host": "localhost"
}
`;
    const indexer = new ConfigIndexer();
    const indexed = indexer.index(configText);
    const computer = new ChangeComputer();
    const instruction = computer.compute(indexed, 'port', 9090);
    const updated = applyInstructions(configText, [instruction]);

    expect(updated).toContain('// porta da API');
    expect(updated).toContain('9090');
    expect(updated).not.toContain('8080');
    expect(updated).toContain('"host": "localhost"');
  });
});

describe('ConfigServer', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'passo03-cfg-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('putConfig, apply, version conflict, and diff', () => {
    const server = new ConfigServer(tmp);
    const initial = `{
  "port": 8080,
  "debug": false
}
`;
    server.putConfig('dev', initial, 'test');
    const { indexed, version } = server.getConfig('dev');
    expect(version).toBe(1);

    const instruction = new ChangeComputer().compute(indexed, 'port', 9090);
    const applied = server.apply('dev', [instruction], version, 'test');
    expect(applied.version).toBe(2);

    expect(() => server.apply('dev', [instruction], 1, 'test')).toThrow(VersionConflictError);

    const diff = server.diff('dev', 1, 2);
    expect(diff.some((d) => d.type === 'del' && d.line.includes('8080'))).toBe(true);
    expect(diff.some((d) => d.type === 'add' && d.line.includes('9090'))).toBe(true);
  });
});

describe('GuiGenerator', () => {
  it('HTML contains form fields for leaf nodes', () => {
    const configText = `{
  "port": 8080,
  "debug": false,
  "name": "api"
}
`;
    const indexed = new ConfigIndexer().index(configText);
    const html = new GuiGenerator().generate(indexed, 'dev');
    expect(html).toContain('<form id="cfg">');
    expect(html).toContain('name="port"');
    expect(html).toContain('name="debug"');
    expect(html).toContain('name="name"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="number"');
  });
});

describe('AgeLikeCrypto (legacy)', () => {
  it('encrypt/decrypt roundtrip', () => {
    const kp = AgeLikeCrypto.generateKeyPair();
    const plaintext = 'secret payload for testing';
    const encrypted = AgeLikeCrypto.encrypt(plaintext, [kp.publicKey]);
    const decrypted = AgeLikeCrypto.decrypt(encrypted, kp.secretKey);
    expect(decrypted.toString('utf8')).toBe(plaintext);
  });

  it('detects tampering via auth tag', () => {
    const kp = AgeLikeCrypto.generateKeyPair();
    const encrypted = AgeLikeCrypto.encrypt('tamper me', [kp.publicKey]);
    const lines = encrypted.split('\n');
    const payloadLine = lines.find((l) => l.trim() !== '' && !l.startsWith('#'))!;
    const tampered = payloadLine.slice(0, -4) + 'XXXX';
    const tamperedFile = lines.map((l) => (l === payloadLine ? tampered : l)).join('\n');
    expect(() => AgeLikeCrypto.decrypt(tamperedFile, kp.secretKey)).toThrow(
      /adulterado|autenticacao|invalido/i,
    );
  });
});

describe('AgeBackend', () => {
  it('round-trip age encrypt/decrypt', async () => {
    const kp = await AgeBackend.generateKeyPair();
    const encrypted = await AgeBackend.encrypt('hello age', [kp.publicKey]);
    const decrypted = await AgeBackend.decrypt(encrypted, kp.secretKey);
    expect(decrypted.toString('utf8')).toBe('hello age');
  });

  it('official age CLI decrypts library ciphertext when the binary is installed', async () => {
    const { execFileSync } = await import('node:child_process');
    const kp = await AgeBackend.generateKeyPair();
    const encrypted = await AgeBackend.encrypt('cli-interop', [kp.publicKey]);
    expect(encrypted.length).toBeGreaterThan(0);

    const bin =
      process.env.AGE_BIN ||
      (existsSync('/opt/homebrew/bin/age') ? '/opt/homebrew/bin/age' : undefined) ||
      (existsSync('/usr/local/bin/age') ? '/usr/local/bin/age' : undefined);
    if (bin === undefined) {
      expect(typeof encrypted).toBe('string');
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'age-interop-'));
    const ident = join(dir, 'key.txt');
    const payload = join(dir, 'secret.age');
    writeFileSync(ident, kp.secretKey);
    writeFileSync(payload, encrypted);
    try {
      const out = execFileSync(bin, ['-d', '-i', ident, payload], { encoding: 'utf8' });
      expect(out).toBe('cli-interop');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('secrets migrate', () => {
  it('legacy fixture → age payload; corrupt file is left intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'age-mig-'));
    const legacyKp = AgeLikeCrypto.generateKeyPair();
    const ageKp = await AgeBackend.generateKeyPair();
    const file = join(dir, 'prod.enc');
    writeFileSync(file, AgeLikeCrypto.encrypt(JSON.stringify({ K: 'v' }), [legacyKp.publicKey]));
    const result = await migrateSecretsFile({
      filePath: file,
      legacySecretKey: legacyKp.secretKey,
      identity: ageKp.secretKey,
    });
    expect(result).toBe('migrated');
    const plain = await AgeBackend.decrypt(readFileSync(file, 'utf8'), ageKp.secretKey);
    expect(JSON.parse(plain.toString('utf8'))).toEqual({ K: 'v' });

    const bad = join(dir, 'bad.enc');
    writeFileSync(bad, 'not-a-payload');
    await expect(
      migrateSecretsFile({
        filePath: bad,
        legacySecretKey: legacyKp.secretKey,
        identity: ageKp.secretKey,
      }),
    ).rejects.toThrow(/intacto|legado/i);
    expect(readFileSync(bad, 'utf8')).toBe('not-a-payload');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('SecretsManager', () => {
  let tmp: string;
  let secretKey: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'passo03-sec-'));
    secretKey = (await AgeBackend.generateKeyPair()).secretKey;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('set/get/listKeys — listKeys never returns values', async () => {
    const manager = new SecretsManager(tmp, secretKey, []);
    await manager.set('prod', 'DB_PASSWORD', 'hunter2');
    await manager.set('prod', 'API_TOKEN', 'tok_abc123');

    expect(await manager.get('prod', 'DB_PASSWORD')).toBe('hunter2');
    expect(await manager.get('prod', 'API_TOKEN')).toBe('tok_abc123');

    const keys = await manager.listKeys('prod');
    expect(keys).toEqual(['API_TOKEN', 'DB_PASSWORD']);
    expect(keys).not.toContain('hunter2');
    expect(keys).not.toContain('tok_abc123');
    for (const k of keys) {
      expect(typeof k).toBe('string');
      expect(k).not.toMatch(/hunter2|tok_abc123/);
    }
  });
});

describe('RepoLayoutGuard', () => {
  it('clean repo passes scan', () => {
    const guard = new RepoLayoutGuard();
    const report = guard.scan(cleanRepo);
    expect(report.clean).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('dirty repo detects secret-outside-secrets', () => {
    const guard = new RepoLayoutGuard();
    const report = guard.scan(dirtyRepo);
    expect(report.clean).toBe(false);
    expect(report.violations.some((v) => v.kind === 'secret-outside-secrets')).toBe(true);
  });
});

describe('CLI main', () => {
  it('scan-deps returns exit code 1 when gate fails', async () => {
    const code = await main([
      'scan-deps',
      '--lockfile',
      sampleLock,
      '--db',
      sampleAdvisories,
      '--fail-on',
      'high',
    ]);
    expect(code).toBe(1);
  });

  it('scan-deps returns exit code 0 when fail-on critical and only high (no critical after suppress)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'passo03-cli-'));
    try {
      const dbOnlyHigh = join(tmp, 'advisories-high-only.json');
      writeFileSync(
        dbOnlyHigh,
        JSON.stringify([
          {
            id: 'GHSA-high-only',
            packageName: 'lodash',
            affectedRanges: ['4.17.20'],
            severity: 'high',
            title: 'High only advisory',
          },
        ]),
      );
      const code = await main([
        'scan-deps',
        '--lockfile',
        sampleLock,
        '--db',
        dbOnlyHigh,
        '--fail-on',
        'critical',
      ]);
      expect(code).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('guard returns 0 for clean layout', async () => {
    const code = await main(['guard', cleanRepo]);
    expect(code).toBe(0);
  });

  it('guard returns 1 for dirty layout', async () => {
    const code = await main(['guard', dirtyRepo]);
    expect(code).toBe(1);
  });
});

describe('secrets HTTP', () => {
  it('POST awaits persistence and GET keys returns string[]', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'passo03-sec-http-'));
    const secretKey = (await AgeBackend.generateKeyPair()).secretKey;
    const app = buildServer({ rootDir: dir, logger: false });
    try {
      const post = await app.inject({
        method: 'POST',
        url: '/secrets/prod/DB_PASSWORD',
        headers: { 'x-age-secret-key': secretKey, 'content-type': 'application/json' },
        payload: { value: 'hunter2' },
      });
      expect(post.statusCode).toBe(200);
      const get = await app.inject({
        method: 'GET',
        url: '/secrets/prod/keys',
        headers: { 'x-age-secret-key': secretKey },
      });
      expect(get.statusCode).toBe(200);
      const body = get.json() as { keys: unknown };
      expect(Array.isArray(body.keys)).toBe(true);
      expect(body.keys).toEqual(['DB_PASSWORD']);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POST without age header fails closed with 401', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'passo03-sec-http-unauth-'));
    const app = buildServer({ rootDir: dir, logger: false });
    try {
      const post = await app.inject({
        method: 'POST',
        url: '/secrets/prod/DB_PASSWORD',
        headers: { 'content-type': 'application/json' },
        payload: { value: 'hunter2' },
      });
      expect(post.statusCode).toBe(401);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
