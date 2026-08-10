/**
 * observability — src/logger.ts
 *
 * Factory pino com bindings de identidade de serviço, child logger por request
 * e redaction de campos sensíveis (password, token, authorization, *_KEY).
 */

import pino from 'pino';
import type { RequestLogFields, ServiceIdentity } from './types.js';

const REDACT_PATHS = [
  'password',
  'token',
  'authorization',
  '*.password',
  '*.token',
  '*.authorization',
  '*_KEY',
  '*_key',
  'API_KEY',
  '*.API_KEY',
  'req.headers.authorization',
  'headers.authorization',
];

export function createRootLogger(
  identity: ServiceIdentity,
  options?: pino.LoggerOptions,
  destination?: pino.DestinationStream,
): pino.Logger {
  return pino(
    {
      level: 'info',
      ...options,
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
        ...(options?.redact && typeof options.redact === 'object' ? options.redact : {}),
      },
      base: {
        service: identity.service,
        version: identity.version,
        deployment_id: identity.deploymentId,
        ...(options?.base && typeof options.base === 'object' ? options.base : {}),
      },
    },
    destination,
  );
}

export function childForRequest(
  logger: pino.Logger,
  fields: Partial<RequestLogFields>,
): pino.Logger {
  return logger.child(fields);
}

export type { Logger, LoggerOptions } from 'pino';
