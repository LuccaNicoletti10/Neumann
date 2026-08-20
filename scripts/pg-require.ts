/**
 * Fail-closed connectivity check. Prints a redacted URL. Never skips.
 */
import { redactDatabaseUrl, waitForPostgres } from 'object-platform';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required for PostgreSQL integration');
    process.exit(1);
  }

  const timeoutMs = Number(process.env.NEUMANN_PG_WAIT_MS ?? 10_000);
  await waitForPostgres(url, { timeoutMs });
  console.log(`postgres reachable at ${redactDatabaseUrl(url)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
