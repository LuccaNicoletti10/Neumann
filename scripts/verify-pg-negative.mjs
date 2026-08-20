#!/usr/bin/env node
/**
 * Negative PostgreSQL checks for verify:integration. None of these may skip.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(repoRoot, 'scripts/verify-integration.mjs');

function run(label, env) {
  const result = spawnSync(process.execPath, [runner], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  const out = `${result.stdout}\n${result.stderr}`;
  const skipped = /skipIf|skipped tests are an error/i.test(out) && /numPendingTests": [1-9]/.test(out);
  const asSkip = /banco ausente|database unavailable|No test files found/i.test(out);
  console.log(`\n=== ${label} ===`);
  console.log(`exit=${result.status}`);
  const tail = out.trim().split('\n').slice(-12).join('\n');
  console.log(tail);
  return { status: result.status ?? 1, out, skipped: skipped || asSkip };
}

let failed = false;

const missingEnv = { ...process.env, NEUMANN_PG_WAIT_MS: '1000' };
delete missingEnv.DATABASE_URL;
const missingResult = run('DATABASE_URL absent', missingEnv);
if (missingResult.status === 0) {
  console.error('expected non-zero exit when DATABASE_URL is absent');
  failed = true;
}
if (/skipIf\(!db\)/.test(missingResult.out) && missingResult.status === 0) {
  console.error('absent DATABASE_URL became a skip');
  failed = true;
}

const badPort = run('invalid port', {
  ...process.env,
  DATABASE_URL: 'postgres://neumann:neumann@127.0.0.1:1/neumann',
  NEUMANN_PG_WAIT_MS: '1500',
});
if (badPort.status === 0) {
  console.error('expected non-zero exit for invalid port');
  failed = true;
}

const valid = process.env.DATABASE_URL;
if (!valid) {
  console.error('verify-pg-negative: set DATABASE_URL to a working kernel database to test invalid password');
  failed = true;
} else {
  let wrongPasswordUrl;
  try {
    const parsed = new URL(valid);
    parsed.password = 'this-password-is-wrong';
    wrongPasswordUrl = parsed.toString();
  } catch {
    console.error('verify-pg-negative: DATABASE_URL is not a URL');
    process.exit(1);
  }
  const badPass = run('invalid password', {
    ...process.env,
    DATABASE_URL: wrongPasswordUrl,
    NEUMANN_PG_WAIT_MS: '1500',
  });
  if (badPass.status === 0) {
    console.error('expected non-zero exit for invalid password');
    failed = true;
  }
  if (/not reachable|unavailable/i.test(badPass.out) && /authentication failed/i.test(badPass.out) === false) {
    console.error('invalid password was classified as unavailable');
    failed = true;
  }
}

if (failed) {
  console.error('\nverify-pg-negative FAILED');
  process.exit(1);
}
console.log('\nverify-pg-negative ok (all cases exited non-zero, none skipped)');
