// Worker de exemplo com chamadas de logging em estilo JS/TS.
const logger = {
  info: (...args: unknown[]) => args,
  error: (...args: unknown[]) => args,
};

export function processJob(jobId: string, elapsed: number): void {
  logger.info("job {} finished in {} ms", jobId, elapsed);
}

export function reportFailure(jobId: string, reason: string): void {
  logger.error(`job ${jobId} failed: ${reason}`);
}
