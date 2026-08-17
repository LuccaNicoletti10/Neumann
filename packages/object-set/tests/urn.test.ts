import { describe, expect, it } from 'vitest';
import { urnOf } from 'contracts';

describe('urnOf', () => {
  it('is stable and unique', () => {
    expect(urnOf('sales', 'ot.order', '1')).toBe('urn:neumann:sales:ot.order:1');
    expect(urnOf('sales', 'ot.order', '1')).toBe(urnOf('sales', 'ot.order', '1'));
    expect(urnOf('sales', 'ot.order', '1')).not.toBe(urnOf('sales', 'ot.order', '2'));
  });
});
