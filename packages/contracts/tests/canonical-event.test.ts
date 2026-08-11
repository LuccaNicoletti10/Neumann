/**
 * contracts — tests/canonical-event.test.ts
 * Golden fixture + estabilidade de serialize/hash (TM0.6 / Passo 6).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  assertCanonicalEvent,
  canonicalizeJson,
  hashPayload,
  parseCanonicalEvent,
  serializeCanonicalEvent,
  type CanonicalEvent,
} from '../src/v1/canonical-event.js';
import { buildGoldenEvent } from '../src/cli.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'canonical-event.golden.json');

describe('CanonicalEvent', () => {
  it('golden fixture round-trip (serialize → parse → mesma forma)', () => {
    const event = buildGoldenEvent();
    const json = serializeCanonicalEvent(event);
    const parsed = parseCanonicalEvent(json);
    expect(parsed).toEqual(event);
    assertCanonicalEvent(parsed);
  });

  it('payload_hash é sha256 estável independente da ordem das chaves', () => {
    const a = hashPayload({ b: 2, a: 1 });
    const b = hashPayload({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('golden fixture em disco bate com buildGoldenEvent', () => {
    const fromDisk = JSON.parse(readFileSync(FIXTURE, 'utf8')) as CanonicalEvent;
    const event = buildGoldenEvent();
    // fixture guarda o envelope completo; payload_hash deve bater
    expect(fromDisk.payload_hash).toBe(event.payload_hash);
    expect(canonicalizeJson(fromDisk.payload)).toBe(canonicalizeJson(event.payload));
    expect(fromDisk.event_id).toBe(event.event_id);
    expect(fromDisk.source_system).toBe(event.source_system);
    expect(fromDisk.policy_tags).toEqual(event.policy_tags);
  });

  it('assertCanonicalEvent rejeita shape inválido', () => {
    expect(() => assertCanonicalEvent({})).toThrow(/campo ausente/);
    expect(() => assertCanonicalEvent(null)).toThrow(/objeto/);
  });
});
