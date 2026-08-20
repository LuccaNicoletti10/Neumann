/**
 * object-platform — tests/ontology-compatibility.test.ts
 *
 * PROMPT 09 item 6: the class of a change comes from the diff of two
 * OntologyVersions, not from the intent of whoever publishes it.
 */
import type { PropertyTypeDef } from 'contracts';
import { describe, expect, it } from 'vitest';

import { classifyOntologyChange } from '../src/core/ontology-compatibility.js';

import { fixtureOntologyVersion } from './version-policy-fixture.js';

const required: PropertyTypeDef = {
  id: 'rank',
  displayName: 'rank',
  baseType: 'string',
  validators: [{ kind: 'required' }],
};

const optional: PropertyTypeDef = { id: 'rank', displayName: 'rank', baseType: 'string' };

function v(
  id: string,
  objectTypes: Record<string, readonly string[]>,
  propertyTypes?: Record<string, PropertyTypeDef>,
) {
  return fixtureOntologyVersion({ id, objectTypes, propertyTypes });
}

describe('ontology compatibility classification', () => {
  it('new optional property is additive-compatible', () => {
    const from = v('ov-1', { 'ot.a': ['n'] });
    const to = v('ov-2', { 'ot.a': ['n', 'note'] });
    const result = classifyOntologyChange(from, to);
    expect(result.class).toBe('additive-compatible');
    expect(result.findings).toEqual([
      {
        class: 'additive-compatible',
        objectTypeId: 'ot.a',
        propertyTypeId: 'note',
        reason: 'new optional property',
      },
    ]);
  });

  it('new required property without default is breaking', () => {
    const from = v('ov-1', { 'ot.a': ['n'] });
    const to = v('ov-2', { 'ot.a': ['n', 'rank'] }, { rank: required });
    const result = classifyOntologyChange(from, to);
    expect(result.class).toBe('breaking');
    expect(result.findings).toContainEqual({
      class: 'breaking',
      objectTypeId: 'ot.a',
      propertyTypeId: 'rank',
      reason: 'new required property has no default',
    });
  });

  it('declared lossless widening is coercible, the reverse is breaking', () => {
    const numeric = v('ov-1', { 'ot.a': ['qty'] }, {
      qty: { id: 'qty', displayName: 'qty', baseType: 'number' },
    });
    const text = v('ov-2', { 'ot.a': ['qty'] }, {
      qty: { id: 'qty', displayName: 'qty', baseType: 'string' },
    });
    expect(classifyOntologyChange(numeric, text).class).toBe('coercible');
    expect(classifyOntologyChange(text, numeric).class).toBe('breaking');
  });

  it('removal, narrowing and endpoint changes are breaking', () => {
    const from = v('ov-1', { 'ot.a': ['n', 'gone'] });
    expect(classifyOntologyChange(from, v('ov-2', { 'ot.a': ['n'] })).class).toBe('breaking');
    expect(classifyOntologyChange(from, v('ov-2', {})).class).toBe('breaking');

    const wide = v('ov-1', { 'ot.a': ['state'] }, {
      state: {
        id: 'state',
        displayName: 'state',
        baseType: 'string',
        validators: [{ kind: 'set', values: ['NEW', 'OLD'] }],
      },
    });
    const narrow = v('ov-2', { 'ot.a': ['state'] }, {
      state: {
        id: 'state',
        displayName: 'state',
        baseType: 'string',
        validators: [{ kind: 'set', values: ['NEW'] }],
      },
    });
    const narrowed = classifyOntologyChange(wide, narrow);
    expect(narrowed.class).toBe('breaking');
    expect(narrowed.findings[0]?.reason).toContain('allowed values removed: OLD');

    const requiredNow = classifyOntologyChange(
      v('ov-1', { 'ot.a': ['rank'] }, { rank: optional }),
      v('ov-2', { 'ot.a': ['rank'] }, { rank: required }),
    );
    expect(requiredNow.class).toBe('breaking');
    expect(requiredNow.findings[0]?.reason).toContain('became required');
  });

  it('link cardinality and endpoint changes are breaking; a new link type is additive', () => {
    const base = fixtureOntologyVersion({
      id: 'ov-1',
      objectTypes: { 'ot.a': ['n'], 'ot.b': ['n'] },
      linkTypes: {
        'lt.r': {
          id: 'lt.r',
          displayName: 'r',
          sourceObjectTypeId: 'ot.a',
          targetObjectTypeId: 'ot.b',
          cardinality: 'N:N',
        },
      },
    });
    const tightened = fixtureOntologyVersion({
      id: 'ov-2',
      objectTypes: { 'ot.a': ['n'], 'ot.b': ['n'] },
      linkTypes: {
        'lt.r': {
          id: 'lt.r',
          displayName: 'r',
          sourceObjectTypeId: 'ot.a',
          targetObjectTypeId: 'ot.b',
          cardinality: 'N:1',
        },
      },
    });
    const added = fixtureOntologyVersion({
      id: 'ov-3',
      objectTypes: { 'ot.a': ['n'], 'ot.b': ['n'] },
      linkTypes: {
        ...base.linkTypes,
        'lt.s': {
          id: 'lt.s',
          displayName: 's',
          sourceObjectTypeId: 'ot.a',
          targetObjectTypeId: 'ot.b',
        },
      },
    });
    expect(classifyOntologyChange(base, tightened).class).toBe('breaking');
    expect(classifyOntologyChange(base, added).class).toBe('additive-compatible');
    expect(classifyOntologyChange(base, fixtureOntologyVersion({
      id: 'ov-4',
      objectTypes: { 'ot.a': ['n'], 'ot.b': ['n'] },
    })).class).toBe('breaking');
  });

  it('versions from different ontologies are invalid, not breaking', () => {
    const a = fixtureOntologyVersion({ id: 'ov-1', ontologyId: 'o1', objectTypes: { 'ot.a': ['n'] } });
    const b = fixtureOntologyVersion({ id: 'ov-2', ontologyId: 'o2', objectTypes: { 'ot.a': ['n'] } });
    const result = classifyOntologyChange(a, b);
    expect(result.class).toBe('invalid');
    expect(result.findings[0]?.reason).toContain('different ontologies');
  });

  it('a version that declares a property with no PropertyType is invalid', () => {
    const from = fixtureOntologyVersion({ id: 'ov-1', objectTypes: { 'ot.a': ['n'] } });
    const broken = { ...from, id: 'ov-2', propertyTypes: {} };
    expect(classifyOntologyChange(from, broken).class).toBe('invalid');
  });

  it('is deterministic and asymmetric', () => {
    const from = v('ov-1', { 'ot.a': ['n'] });
    const to = v('ov-2', { 'ot.a': ['n', 'note'] });
    expect(classifyOntologyChange(from, to)).toEqual(classifyOntologyChange(from, to));
    // Dropping `note` again is not additive: direction carries meaning.
    expect(classifyOntologyChange(to, from).class).toBe('breaking');
  });

  it('reports the worst finding when a change mixes classes', () => {
    const from = v('ov-1', { 'ot.a': ['qty'] }, {
      qty: { id: 'qty', displayName: 'qty', baseType: 'number' },
    });
    const to = v('ov-2', { 'ot.a': ['qty', 'note', 'rank'] }, {
      qty: { id: 'qty', displayName: 'qty', baseType: 'string' },
      rank: required,
    });
    const result = classifyOntologyChange(from, to);
    expect(result.class).toBe('breaking');
    expect(result.findings.map((f) => f.class).sort()).toEqual([
      'additive-compatible',
      'breaking',
      'coercible',
    ]);
  });
});
