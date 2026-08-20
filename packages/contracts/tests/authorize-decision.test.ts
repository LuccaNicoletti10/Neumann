/**
 * Canonical AuthorizeResult interpreter — mutations require allow.
 */
import { describe, expect, it } from 'vitest';

import type { AuthzDecision, AuthorizeResult, PolicyOperation } from '../src/v1/policy.js';
import {
  allowsMutation,
  allowsRead,
  authorizeProceeds,
  isReadOperation,
} from '../src/v1/policy.js';

function result(decision: AuthzDecision): AuthorizeResult {
  return {
    decision,
    principalEpids: decision === 'deny' ? [] : ['e'],
    resourceEpid: decision === 'deny' ? null : 'e',
    reason: decision,
  };
}

describe('authorizeProceeds', () => {
  it('isReadOperation covers read/list/count only', () => {
    expect(isReadOperation('read')).toBe(true);
    expect(isReadOperation('list')).toBe(true);
    expect(isReadOperation('count')).toBe(true);
    expect(isReadOperation('create')).toBe(false);
    expect(isReadOperation('modify')).toBe(false);
    expect(isReadOperation('delete')).toBe(false);
  });

  it('partial never authorizes mutation; read may proceed', () => {
    expect(allowsMutation(result('allow'))).toBe(true);
    expect(allowsMutation(result('partial'))).toBe(false);
    expect(allowsMutation(result('deny'))).toBe(false);
    expect(allowsRead(result('allow'))).toBe(true);
    expect(allowsRead(result('partial'))).toBe(true);
    expect(allowsRead(result('deny'))).toBe(false);
  });

  it('matrix deny | partial | allow for every PolicyOperation', () => {
    const writes: PolicyOperation[] = ['create', 'modify', 'delete'];
    const reads: PolicyOperation[] = ['read', 'list', 'count'];
    for (const op of writes) {
      expect(authorizeProceeds(op, result('allow'))).toBe(true);
      expect(authorizeProceeds(op, result('partial'))).toBe(false);
      expect(authorizeProceeds(op, result('deny'))).toBe(false);
    }
    for (const op of reads) {
      expect(authorizeProceeds(op, result('allow'))).toBe(true);
      expect(authorizeProceeds(op, result('partial'))).toBe(true);
      expect(authorizeProceeds(op, result('deny'))).toBe(false);
    }
  });
});
