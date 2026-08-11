/**
 * tagging-interface-panel — tests/options.test.ts
 * Testes das opções de tag e do Create Tag button.
 */
import { describe, expect, it } from 'vitest';

import { createTagButton, fieldsForOption } from '../src/core/options.js';
import { createFixedClock, createIdGenerator } from './helpers.js';

const deps = () => ({
  clock: createFixedClock('2014-09-18T12:00:00.000Z'),
  newId: createIdGenerator(),
  user: 'analista',
});

describe('fieldsForOption', () => {
  it('object (406): apenas TITLE e TYPE', () => {
    expect(fieldsForOption('object').map((f) => f.id)).toEqual(['TITLE', 'TYPE']);
  });

  it('property (404): adiciona campo LINK_TO_OBJECT', () => {
    expect(fieldsForOption('property').map((f) => f.id)).toEqual([
      'TITLE',
      'TYPE',
      'LINK_TO_OBJECT',
    ]);
  });

  it('link (408): adiciona campos LINK_TARGET_1 e LINK_TARGET_2', () => {
    expect(fieldsForOption('link').map((f) => f.id)).toEqual([
      'TITLE',
      'TYPE',
      'LINK_TARGET_1',
      'LINK_TARGET_2',
    ]);
  });
});

describe('createTagButton (414)', () => {
  it('cria object tag com DateAdded vindo do clock e ids determinísticos', () => {
    const d = deps();
    const tag = createTagButton(
      { option: 'object', title: 'Curiosity', type: 'Ground Travel', contentLabel: 'content-1' },
      d,
    );
    expect(tag).toEqual({
      id: 'tag-1',
      kind: 'object',
      title: 'Curiosity',
      type: 'Ground Travel',
      contentLabel: 'content-1',
      dateAdded: '2014-09-18T12:00:00.000Z',
      user: 'analista',
    });
  });

  it('ids são sequenciais por prefixo', () => {
    const d = deps();
    const a = createTagButton(
      { option: 'object', title: 'A', type: 'T', contentLabel: 'c' },
      d,
    );
    const b = createTagButton(
      { option: 'object', title: 'B', type: 'T', contentLabel: 'c' },
      d,
    );
    expect([a.id, b.id]).toEqual(['tag-1', 'tag-2']);
  });

  it('property tag exige exatamente 1 objeto alvo', () => {
    expect(() =>
      createTagButton(
        { option: 'property', title: 'P', type: 'Name', contentLabel: 'c' },
        deps(),
      ),
    ).toThrow(/exatamente 1 objeto alvo/);
    expect(() =>
      createTagButton(
        {
          option: 'property',
          title: 'P',
          type: 'Name',
          contentLabel: 'c',
          targetObjectIds: ['tag-1', 'tag-2'],
        },
        deps(),
      ),
    ).toThrow(/exatamente 1 objeto alvo/);
  });

  it('property tag com 1 objeto alvo é criada com o vínculo', () => {
    const tag = createTagButton(
      {
        option: 'property',
        title: 'Smith, Jane',
        type: 'Name',
        contentLabel: 'c',
        targetObjectIds: ['tag-1'],
      },
      deps(),
    );
    expect(tag.kind).toBe('property');
    expect(tag.targetObjectIds).toEqual(['tag-1']);
  });

  it('link tag exige 2+ objetos ou 2+ propriedades alvo', () => {
    expect(() =>
      createTagButton(
        {
          option: 'link',
          title: 'L',
          type: 'Vehicle',
          contentLabel: 'c',
          targetObjectIds: ['tag-1'],
        },
        deps(),
      ),
    ).toThrow(/2\+ objetos ou 2\+ propriedades/);
  });

  it('link tag com 2+ objetos é criada', () => {
    const tag = createTagButton(
      {
        option: 'link',
        title: 'L',
        type: 'Vehicle',
        contentLabel: 'c',
        targetObjectIds: ['tag-1', 'tag-2'],
      },
      deps(),
    );
    expect(tag.kind).toBe('link');
    expect(tag.targetObjectIds).toEqual(['tag-1', 'tag-2']);
  });

  it('link tag com 2+ propriedades é criada', () => {
    const tag = createTagButton(
      {
        option: 'link',
        title: 'L',
        type: 'Name',
        contentLabel: 'c',
        targetPropertyIds: ['tag-3', 'tag-4'],
      },
      deps(),
    );
    expect(tag.targetPropertyIds).toEqual(['tag-3', 'tag-4']);
  });

  it('rejeita TITLE ou TYPE vazios', () => {
    expect(() =>
      createTagButton({ option: 'object', title: ' ', type: 'T', contentLabel: 'c' }, deps()),
    ).toThrow(/TITLE/);
    expect(() =>
      createTagButton({ option: 'object', title: 'T', type: '', contentLabel: 'c' }, deps()),
    ).toThrow(/TYPE/);
  });
});
