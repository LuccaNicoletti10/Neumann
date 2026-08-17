/**
 * contracts — tests/classification.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  CONFIDENTIAL,
  SECRET,
  UNCLASSIFIED,
  canViewAtLevel,
  classificationFromPolicyTags,
  classificationPolicyTag,
  disseminationView,
  inheritClassification,
  maxClassification,
  minClassification,
  commonViewingLevel,
  sharingConstraint,
} from '../src/v1/classification.js';

describe('Passo 26 contracts — classification', () => {
  it('max / inherit: Confidential + Unclassified → Confidential', () => {
    const inherited = inheritClassification(['Confidential', 'Unclassified']);
    expect(inherited.name).toBe(CONFIDENTIAL.name);
    expect(maxClassification([UNCLASSIFIED, SECRET]).name).toBe(SECRET.name);
  });

  it('canViewAtLevel: viewing Confidential sees U+C, not Secret', () => {
    expect(canViewAtLevel('Unclassified', 'Confidential')).toBe(true);
    expect(canViewAtLevel('Confidential', 'Confidential')).toBe(true);
    expect(canViewAtLevel('Secret', 'Confidential')).toBe(false);
  });

  it('disseminationView filtra pelo viewing level', () => {
    const view = disseminationView(
      [
        { id: 'a', classification: 'Unclassified' },
        { id: 'b', classification: 'Confidential' },
        { id: 'c', classification: 'Secret' },
      ],
      'Confidential',
    );
    expect(view.banner).toBe('Confidential');
    expect(view.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('sharingConstraint is max of both ends', () => {
    expect(sharingConstraint('Unclassified', 'Confidential').name).toBe('Confidential');
  });

  it('policy_tags round-trip classification:', () => {
    const tag = classificationPolicyTag(CONFIDENTIAL);
    expect(tag).toBe('classification:Confidential');
    expect(classificationFromPolicyTags([tag, 'pii']).name).toBe('Confidential');
    expect(classificationFromPolicyTags(['Unclassified']).name).toBe('Unclassified');
  });

  it('commonViewingLevel is min of principals (US 9,501,761)', () => {
    expect(minClassification(['Secret', 'Confidential']).name).toBe('Confidential');
    expect(
      commonViewingLevel([
        { id: 'alice', maxClassification: 'Top Secret' },
        { id: 'bob', maxClassification: 'Secret' },
      ]).name,
    ).toBe('Secret');
  });
});
