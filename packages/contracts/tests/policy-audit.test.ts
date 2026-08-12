/**
 * contracts — tests/policy-audit.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildGoldenAuditEntry } from '../src/v1/audit.js';
import {
  assertAuthorizeResult,
  buildGoldenAuthorizeRequest,
} from '../src/v1/policy.js';

describe('Passo 16 contracts — policy + audit', () => {
  it('golden AuthorizeRequest tem principal/resource/operation', () => {
    const req = buildGoldenAuthorizeRequest();
    expect(req.principal).toBe('user-alice');
    expect(req.resource).toBe('ds-sales-v1');
    expect(req.operation).toBe('read');
  });

  it('assertAuthorizeResult aceita allow', () => {
    assertAuthorizeResult({
      decision: 'allow',
      principalEpids: ['epid-1'],
      resourceEpid: 'epid-1',
      reason: 'epid match',
    });
  });

  it('golden AuditEntry tem chain fields', () => {
    const e = buildGoldenAuditEntry();
    expect(e.logHash).toHaveLength(64);
    expect(e.summaryHash).toHaveLength(64);
    expect(e.previousSummaryHash).toHaveLength(64);
  });
});
