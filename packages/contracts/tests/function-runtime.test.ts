/**
 * contracts — FunctionRuntime pin and state machine (ADR-0019).
 */
import { describe, expect, it } from 'vitest';

import {
  FUNCTION_TERMINAL_STATUSES,
  assertFunctionDef,
  assertFunctionExecutionPin,
  buildGoldenFunctionDef,
  isFunctionTerminal,
  type FunctionRuntime,
} from '../src/v1/function-runtime.js';

describe('FunctionRuntime contracts (ADR-0019)', () => {
  it('pin requires SHA-256 artifact hash and version >= 1', () => {
    expect(() =>
      assertFunctionExecutionPin({
        ontologyId: 'o',
        ontologyVersionId: 'v',
        functionId: 'fn.x',
        functionVersion: 1,
        artifactHash: 'ab'.repeat(32),
        inputSchemaHash: 'a'.repeat(64),
        outputSchemaHash: 'b'.repeat(64),
      }),
    ).not.toThrow();
    expect(() => assertFunctionExecutionPin(null)).toThrow(/required/);
    expect(() =>
      assertFunctionExecutionPin({
        ontologyId: '',
        ontologyVersionId: 'v',
        functionId: 'fn.x',
        functionVersion: 1,
        artifactHash: 'ab'.repeat(32),
        inputSchemaHash: 'a'.repeat(64),
        outputSchemaHash: 'b'.repeat(64),
      }),
    ).toThrow(/ontologyId/);
    expect(() =>
      assertFunctionExecutionPin({
        ontologyId: 'o',
        ontologyVersionId: 'v',
        functionId: 'fn.x',
        functionVersion: 0,
        artifactHash: 'ab'.repeat(32),
        inputSchemaHash: 'a'.repeat(64),
        outputSchemaHash: 'b'.repeat(64),
      }),
    ).toThrow(/functionVersion/);
    expect(isFunctionTerminal('RUNNING')).toBe(false);
    expect(isFunctionTerminal('FAILED')).toBe(true);
    expect(isFunctionTerminal('DENIED')).toBe(true);
    expect(isFunctionTerminal('CANCELLED')).toBe(true);
  });

  it('terminal statuses do not include PENDING or RUNNING', () => {
    expect(FUNCTION_TERMINAL_STATUSES).toEqual([
      'SUCCEEDED',
      'FAILED',
      'DENIED',
      'CANCELLED',
    ]);
    expect(isFunctionTerminal('PENDING')).toBe(false);
    expect(isFunctionTerminal('SUCCEEDED')).toBe(true);
  });

  it('FunctionRuntime has no process-local register/invoke', () => {
    const keys: (keyof FunctionRuntime)[] = ['create', 'get', 'cancel', 'runOnce'];
    expect(keys).toContain('create');
    expect('register' in ({} as FunctionRuntime)).toBe(false);
    expect('invoke' in ({} as FunctionRuntime)).toBe(false);
  });

  it('legacy FunctionDef stays pure and golden', () => {
    const def = buildGoldenFunctionDef();
    expect(def.pure).toBe(true);
    expect(() => assertFunctionDef(def)).not.toThrow();
    expect(() => assertFunctionDef({ ...def, id: '' })).toThrow(/id/);
  });
});
