/**
 * connector-sdk — src/core/types.ts
 */

export type Clock = () => string;

export type IdGenerator = (prefix: string) => string;
