import PgBoss from 'pg-boss';

export interface PgBossHandle {
  boss: PgBoss;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createPgBoss(connectionString?: string): Promise<PgBossHandle> {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for pg-boss adapter');
  }

  const boss = new PgBoss({
    connectionString: url,
    retryLimit: 5,
    retryBackoff: true,
  });

  return {
    boss,
    start: async () => {
      await boss.start();
    },
    stop: async () => {
      await boss.stop();
    },
  };
}

export async function enqueuePgBossJob<T extends object>(
  boss: PgBoss,
  name: string,
  payload: T,
  options: { priority?: number; retryLimit?: number } = {},
): Promise<string | null> {
  const sendOptions: { retryLimit: number; priority?: number } = {
    retryLimit: options.retryLimit ?? 5,
  };
  if (options.priority !== undefined) {
    sendOptions.priority = options.priority;
  }
  return boss.send(name, payload, sendOptions);
}
