/**
 * auth-record.ts — AuthenticationRecord.
 *
 * Componente da patente US 8,763,078 (implementacao funcional independente):
 * registro de CADA tentativa de autenticacao (sucesso OU falha), com a
 * credencial usada, timestamp, IP, localizacao (opcional) e user agent.
 */

import { randomUUID } from 'node:crypto';

export interface GeoLocation {
  lat: number;
  lon: number;
}

export interface AuthAttemptContext {
  ip: string;
  userAgent?: string;
  location?: GeoLocation;
}

export interface AuthenticationRecord {
  attemptId: string;
  /** Identificador da credencial usada (email do usuario ou nome da service account). */
  userId: string;
  success: boolean;
  timestamp: string; // ISO 8601
  ip: string;
  location?: GeoLocation;
  userAgent?: string;
  /** Marcado como suspeito quando o usuario responde a notificacao com "reportBreach". */
  flaggedAsBreach: boolean;
}

export function buildAuthRecord(
  input: Omit<AuthenticationRecord, 'attemptId' | 'timestamp' | 'flaggedAsBreach'> & { timestamp?: string },
): AuthenticationRecord {
  const base: AuthenticationRecord = {
    attemptId: randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    userId: input.userId,
    success: input.success,
    ip: input.ip,
    flaggedAsBreach: false,
  };
  if (input.location !== undefined) base.location = input.location;
  if (input.userAgent !== undefined) base.userAgent = input.userAgent;
  return base;
}
