/**
 * contracts — src/v1/noninterference.ts
 * Passo 28: 8 canais + fuzzing de autorização. Shape congelado.
 *
 * WO2022245989 — controle de ações/acesso.
 * US 10,044,745 — avaliação de risco (fuzzing da matriz).
 *
 * Observação de um principal sem acesso deve ser idêntica no mundo
 * em que o recurso secreto existe e no mundo em que ele não existe.
 */

import type { AuthzContext, AuthzDecision, PolicyOperation } from './policy.js';

export const NONINTERFERENCE_CHANNELS = [
  'count',
  'error',
  'autocomplete',
  'index',
  'embeddings',
  'cache',
  'llm',
  'logs',
] as const;

export type NoninterferenceChannel = (typeof NONINTERFERENCE_CHANNELS)[number];

/** Envelope canônico de miss (negado ≡ inexistente). */
export interface HiddenMiss {
  statusCode: 404;
  errorCode: 'NOT_FOUND';
  errorName: 'ResourceNotFound';
  message: 'not found';
}

export const HIDDEN_MISS: HiddenMiss = {
  statusCode: 404,
  errorCode: 'NOT_FOUND',
  errorName: 'ResourceNotFound',
  message: 'not found',
};

export interface ChannelObservation {
  channel: NoninterferenceChannel;
  /** Fingerprint canônico — sem payload classificado. */
  fingerprint: string;
}

export interface ProbeResult {
  principal: string;
  observations: ChannelObservation[];
}

export interface NoninterferenceReport {
  ok: boolean;
  /** Canais em que mundo-com-segredo ≠ mundo-sem-segredo. */
  leaked: NoninterferenceChannel[];
  present: ProbeResult;
  absent: ProbeResult;
}

export interface AuthzFuzzCase {
  principal: string;
  resource: string;
  operation: PolicyOperation;
  context?: AuthzContext;
}

export interface AuthzFuzzViolation {
  case: AuthzFuzzCase;
  expected: AuthzDecision;
  actual: AuthzDecision;
}

export interface AuthzFuzzReport {
  rounds: number;
  seed: number;
  violations: AuthzFuzzViolation[];
}

export function assertHiddenMiss(v: HiddenMiss): void {
  if (v.statusCode !== 404) throw new Error('HiddenMiss: statusCode deve ser 404');
  if (v.errorCode !== 'NOT_FOUND') throw new Error('HiddenMiss: errorCode NOT_FOUND');
  if (v.message !== 'not found') throw new Error('HiddenMiss: message canônica');
}

export function fingerprintsEqual(a: ProbeResult, b: ProbeResult): NoninterferenceChannel[] {
  const leaked: NoninterferenceChannel[] = [];
  for (const ch of NONINTERFERENCE_CHANNELS) {
    const fa = a.observations.find((o) => o.channel === ch)?.fingerprint ?? '';
    const fb = b.observations.find((o) => o.channel === ch)?.fingerprint ?? '';
    if (fa !== fb) leaked.push(ch);
  }
  return leaked;
}
