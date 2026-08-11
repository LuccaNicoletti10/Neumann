/**
 * external-content-exporter — tests/tagging.test.ts
 * Testes do mecanismo 4 (RECEPÇÃO DA TAG CRIADA na tagging interface).
 */
import { describe, expect, it } from 'vitest';

import { createDeterministicClock, createIdGenerator } from '../src/core/determinism.js';
import { createTaggingSession, validateSelection } from '../src/core/tagging.js';
import { CoreError } from '../src/core/types.js';
import { makeStack, sampleContent, sampleSession } from './helpers.js';

describe('tagging interface (passo 520)', () => {
  it('seleciona porção de texto com offsets válidos', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const selection = session.selectPortion({ kind: 'text', startOffset: 0, endOffset: 12 });
    expect(selection).toEqual({ kind: 'text', startOffset: 0, endOffset: 12 });
  });

  it('suporta região de imagem, frame de vídeo e segmento de áudio', () => {
    expect(validateSelection({ kind: 'image-region', region: { x: 1, y: 2, width: 3, height: 4 } }).kind).toBe('image-region');
    expect(validateSelection({ kind: 'video-frame', frameNumber: 7 })).toEqual({ kind: 'video-frame', frameNumber: 7 });
    expect(validateSelection({ kind: 'audio-segment', startSecond: 1, endSecond: 5 }).kind).toBe('audio-segment');
  });

  it('rejeita seleções inválidas para cada tipo', () => {
    expect(() => validateSelection({ kind: 'text', startOffset: 5, endOffset: 5 })).toThrow(CoreError);
    expect(() => validateSelection({ kind: 'image-region', region: { x: 0, y: 0, width: 0, height: 1 } })).toThrow(/região de imagem/);
    expect(() => validateSelection({ kind: 'video-frame', frameNumber: -1 })).toThrow(/frame de vídeo/);
    expect(() => validateSelection({ kind: 'audio-segment', startSecond: 3, endSecond: 3 })).toThrow(/segmento de áudio/);
  });

  it('cria tag associada à porção tagueada e a recebe na sessão', () => {
    const stack = makeStack();
    const { session, content } = sampleSession(stack);
    const tag = session.createTag(
      { tagOption: 'object', title: 'Pessoa', type: 'Person' },
      { kind: 'text', startOffset: 0, endOffset: 4 },
    );
    expect(tag.id).toBe('tag-1');
    expect(tag.contentLabel).toBe(content.label);
    expect(tag.user).toBe('analyst');
    expect(tag.selection).toEqual({ kind: 'text', startOffset: 0, endOffset: 4 });
    expect(session.tags()).toHaveLength(1);
  });

  it('DateAdded vem do clock injetável (determinístico)', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = session.createTag(
      { tagOption: 'property', title: 'Nome', type: 'Person' },
      { kind: 'text', startOffset: 0, endOffset: 4 },
    );
    // O clock da stack começa em 2024-01-01T00:00:00Z (1ª chamada).
    expect(tag.dateAdded).toBe('2024-01-01T00:00:00.000Z');
  });

  it('reutiliza a última porção selecionada quando nenhuma é passada', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    session.selectPortion({ kind: 'text', startOffset: 2, endOffset: 8 });
    const tag = session.createTag({ tagOption: 'object', title: 'T', type: 'Person' });
    expect(tag.selection).toEqual({ kind: 'text', startOffset: 2, endOffset: 8 });
  });

  it('exige porção selecionada antes de criar a tag', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    expect(() =>
      session.createTag({ tagOption: 'object', title: 'T', type: 'Person' }),
    ).toThrow(/SELECTION_REQUIRED|selecione uma porção/);
  });

  it('valida tagOption/título/tipo na criação', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const selection = { kind: 'text' as const, startOffset: 0, endOffset: 1 };
    expect(() =>
      session.createTag({ tagOption: 'estranho' as never, title: 'T', type: 'X' }, selection),
    ).toThrow(/tagOption deve ser uma de/);
    expect(() =>
      session.createTag({ tagOption: 'object', title: ' ', type: 'X' }, selection),
    ).toThrow(/título da tag não pode ser vazio/);
    expect(() =>
      session.createTag({ tagOption: 'object', title: 'T', type: ' ' }, selection),
    ).toThrow(/tipo da tag não pode ser vazio/);
  });

  it('modifyTag altera título/tipo após a criação', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = session.createTag(
      { tagOption: 'link', title: 'Antes', type: 'CaseLink' },
      { kind: 'text', startOffset: 0, endOffset: 4 },
    );
    const modified = session.modifyTag(tag.id, { title: 'Depois', type: 'EventLink' });
    expect(modified.title).toBe('Depois');
    expect(modified.type).toBe('EventLink');
    expect(session.getTag(tag.id)?.title).toBe('Depois');
  });

  it('modifyTag falha para tag inexistente ou valores vazios', () => {
    const stack = makeStack();
    const { session } = sampleSession(stack);
    const tag = session.createTag(
      { tagOption: 'object', title: 'T', type: 'Person' },
      { kind: 'text', startOffset: 0, endOffset: 1 },
    );
    expect(() => session.modifyTag('tag-99', { title: 'X' })).toThrow(/tag não encontrada na sessão/);
    expect(() => session.modifyTag(tag.id, { title: ' ' })).toThrow(/título da tag não pode ser vazio/);
    expect(() => session.modifyTag(tag.id, { type: ' ' })).toThrow(/tipo da tag não pode ser vazio/);
  });

  it('suporta os três tagOptions (object, property, link)', () => {
    const content = sampleContent(createIdGenerator());
    const session = createTaggingSession(content, {
      clock: createDeterministicClock(),
      nextId: createIdGenerator(),
    });
    for (const tagOption of ['object', 'property', 'link'] as const) {
      const tag = session.createTag(
        { tagOption, title: `T-${tagOption}`, type: 'X' },
        { kind: 'text', startOffset: 0, endOffset: 1 },
      );
      expect(tag.tagOption).toBe(tagOption);
    }
    expect(session.tags()).toHaveLength(3);
  });
});
