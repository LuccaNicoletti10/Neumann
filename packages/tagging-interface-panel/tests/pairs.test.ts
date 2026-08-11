/**
 * tagging-interface-panel — tests/pairs.test.ts
 * Testes dos pares parâmetro-valor e do cache de conteúdo por label.
 */
import { describe, expect, it } from 'vitest';

import {
  ContentLabelStore,
  gatherParameterValuePairs,
  tagOptionLabel,
} from '../src/core/pairs.js';
import type { Tag } from '../src/core/types.js';
import { createIdGenerator } from './helpers.js';

const tag: Tag = {
  id: 'tag-1',
  kind: 'object',
  title: 'Curiosity',
  type: 'Ground Travel',
  contentLabel: 'content-1',
  dateAdded: '2014-09-18T12:00:00.000Z',
  user: 'analista',
};

describe('gatherParameterValuePairs', () => {
  it('produz os pares exatos TagOption/Title/Type/Content/DateAdded/User', () => {
    expect(gatherParameterValuePairs(tag)).toEqual([
      { parameter: 'TagOption', value: 'Object' },
      { parameter: 'Title', value: 'Curiosity' },
      { parameter: 'Type', value: 'Ground Travel' },
      { parameter: 'Content', value: 'content-1' },
      { parameter: 'DateAdded', value: '2014-09-18T12:00:00.000Z' },
      { parameter: 'User', value: 'analista' },
    ]);
  });

  it('DateAdded reflete o valor do clock gravado na tag', () => {
    const outra = { ...tag, dateAdded: '2014-09-18T12:01:00.000Z' };
    const pairs = gatherParameterValuePairs(outra);
    expect(pairs.find((p) => p.parameter === 'DateAdded')?.value).toBe(
      '2014-09-18T12:01:00.000Z',
    );
  });

  it('TagOption capitalizado para property e link', () => {
    expect(tagOptionLabel('property')).toBe('Property');
    expect(tagOptionLabel('link')).toBe('Link');
    expect(gatherParameterValuePairs({ ...tag, kind: 'link' })[0]?.value).toBe('Link');
  });
});

describe('ContentLabelStore (cache/diretório por label)', () => {
  it('armazena conteúdo sob label determinístico', () => {
    const store = new ContentLabelStore(createIdGenerator());
    const label = store.save('conteúdo externo da página');
    expect(label).toBe('content-1');
    expect(store.load('content-1')).toBe('conteúdo externo da página');
  });

  it('labels são sequenciais e listados em ordem de inserção', () => {
    const store = new ContentLabelStore(createIdGenerator());
    store.save('a');
    store.save('b');
    expect(store.labels()).toEqual(['content-1', 'content-2']);
  });

  it('aceita representação audiovisual (dados binários serializados)', () => {
    const store = new ContentLabelStore(createIdGenerator());
    const label = store.save('<dados audiovisuais: frame=1 codec=ascii>');
    expect(store.has(label)).toBe(true);
  });

  it('label desconhecido retorna undefined e has=false', () => {
    const store = new ContentLabelStore(createIdGenerator());
    expect(store.load('content-9')).toBeUndefined();
    expect(store.has('content-9')).toBe(false);
  });
});
