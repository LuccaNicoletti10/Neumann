/**
 * tagging-interface-panel — tests/fields.test.ts
 * Testes do auto-preenchimento e edição dos campos TITLE/TYPE.
 */
import { describe, expect, it } from 'vitest';

import {
  autoPopulate,
  DEFAULT_FALLBACK_TYPE,
  manualFill,
  modifyAfterCreate,
  pullDownOptions,
} from '../src/core/fields.js';
import type { InterfaceField, Tag } from '../src/core/types.js';

describe('autoPopulate (TITLE 412 / TYPE 410)', () => {
  it('texto selecionado → TITLE = texto selecionado', () => {
    const result = autoPopulate({ contentKind: 'text', selectedText: 'Curiosity' });
    expect(result.title).toBe('Curiosity');
  });

  it('TYPE inferido por regra: "Curiosity" → "Ground Travel"', () => {
    const result = autoPopulate({ contentKind: 'text', selectedText: 'Curiosity' });
    expect(result.type).toBe('Ground Travel');
  });

  it('TYPE inferido: menção a voo → "Air Travel"', () => {
    const result = autoPopulate({ contentKind: 'text', selectedText: 'Odyssey flight' });
    expect(result.type).toBe('Air Travel');
  });

  it('TYPE inferido: padrão de SSN → "Social Security Number"', () => {
    const result = autoPopulate({ contentKind: 'text', selectedText: '123-45-6789' });
    expect(result.type).toBe('Social Security Number');
  });

  it('sem regra casando, TYPE é o fallback', () => {
    const result = autoPopulate({ contentKind: 'text', selectedText: 'xyz qualquer' });
    expect(result.type).toBe(DEFAULT_FALLBACK_TYPE);
  });

  it('conteúdo audiovisual sem texto usa marcador de TITLE', () => {
    const result = autoPopulate({ contentKind: 'image', selectedText: '' });
    expect(result.title).toBe('<conteúdo audiovisual>');
  });

  it('regras customizadas têm precedência pela ordem', () => {
    const result = autoPopulate({
      contentKind: 'text',
      selectedText: 'Curiosity',
      rules: [{ pattern: /curiosity/i, type: 'Vehicle' }],
    });
    expect(result.type).toBe('Vehicle');
  });
});

describe('manualFill / pullDownOptions / modifyAfterCreate', () => {
  it('manualFill preenche apenas o campo indicado (retorna cópia)', () => {
    const fields: InterfaceField[] = [
      { id: 'TITLE', label: 'Title' },
      { id: 'TYPE', label: 'Type' },
    ];
    const updated = manualFill(fields, 'TITLE', 'Curiosity');
    expect(updated[0]?.value).toBe('Curiosity');
    expect(updated[1]?.value).toBeUndefined();
    expect(fields[0]?.value).toBeUndefined();
  });

  it('pull-down de TYPE lista os tipos disponíveis', () => {
    expect(pullDownOptions('TYPE', ['Person', 'Vehicle'])).toEqual(['Person', 'Vehicle']);
  });

  it('pull-down de OPTION lista as três opções de tag', () => {
    expect(pullDownOptions('OPTION', [])).toEqual(['property', 'object', 'link']);
  });

  it('pull-down de campo desconhecido retorna vazio', () => {
    expect(pullDownOptions('OUTRO', ['A'])).toEqual([]);
  });

  it('modifyAfterCreate altera o TYPE após a criação (Ground → Air Travel)', () => {
    const tag: Tag = {
      id: 'tag-1',
      kind: 'object',
      title: 'Curiosity',
      type: 'Ground Travel',
      contentLabel: 'content-1',
      dateAdded: '2014-09-18T12:00:00.000Z',
      user: 'analista',
    };
    const updated = modifyAfterCreate(tag, 'Air Travel');
    expect(updated.type).toBe('Air Travel');
    expect(tag.type).toBe('Ground Travel');
  });

  it('modifyAfterCreate rejeita TYPE vazio', () => {
    const tag: Tag = {
      id: 'tag-1',
      kind: 'object',
      title: 'Curiosity',
      type: 'Ground Travel',
      contentLabel: 'content-1',
      dateAdded: '2014-09-18T12:00:00.000Z',
      user: 'analista',
    };
    expect(() => modifyAfterCreate(tag, '  ')).toThrow(/TYPE não pode ser vazio/);
  });
});
