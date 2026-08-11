/**
 * external-content-exporter — src/core/tagging.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: TAGGING INTERFACE — exibida
 * quando o bookmarklet melhora o browser; o usuário seleciona uma porção do
 * conteúdo (texto, região de imagem, frame de vídeo, segmento de áudio) e cria
 * uma tag associada à porção tagueada; a interface recebe a tag criada e
 * permite modificá-la (título/tipo) após a criação. Nenhum texto dos claims é
 * reproduzido; apenas a funcionalidade é reimplementada de forma original.
 */

import { createDeterministicClock, createIdGenerator } from './determinism.js';
import { CoreError } from './types.js';
import type {
  Clock,
  ContentSelection,
  ExternalContent,
  IdGenerator,
  SelectionKind,
  Tag,
  TagOption,
} from './types.js';

/** Opções de classificação da tag na ontology/object model. */
export const TAG_OPTIONS: readonly TagOption[] = ['object', 'property', 'link'];

/** Dados informados pelo usuário ao criar a tag na tagging interface. */
export interface CreateTagInput {
  tagOption: TagOption;
  title: string;
  type: string;
}

/** Valida uma seleção de porção conforme o seu tipo. */
export function validateSelection(selection: ContentSelection): ContentSelection {
  const kinds: readonly SelectionKind[] = ['text', 'image-region', 'video-frame', 'audio-segment'];
  if (!kinds.includes(selection.kind)) {
    throw new CoreError('INVALID_SELECTION', `tipo de seleção inválido: ${selection.kind}`);
  }
  switch (selection.kind) {
    case 'text': {
      const { startOffset, endOffset } = selection;
      if (
        startOffset === undefined ||
        endOffset === undefined ||
        !Number.isInteger(startOffset) ||
        !Number.isInteger(endOffset) ||
        startOffset < 0 ||
        endOffset <= startOffset
      ) {
        throw new CoreError(
          'INVALID_SELECTION',
          'seleção de texto exige offsets inteiros com 0 <= início < fim',
        );
      }
      return { kind: 'text', startOffset, endOffset };
    }
    case 'image-region': {
      const { region } = selection;
      if (
        region === undefined ||
        region.width <= 0 ||
        region.height <= 0 ||
        region.x < 0 ||
        region.y < 0
      ) {
        throw new CoreError(
          'INVALID_SELECTION',
          'seleção de região de imagem exige coordenadas válidas (x,y >= 0, largura/altura > 0)',
        );
      }
      return { kind: 'image-region', region: { ...region } };
    }
    case 'video-frame': {
      const { frameNumber } = selection;
      if (frameNumber === undefined || !Number.isInteger(frameNumber) || frameNumber < 0) {
        throw new CoreError(
          'INVALID_SELECTION',
          'seleção de frame de vídeo exige número de frame inteiro >= 0',
        );
      }
      return { kind: 'video-frame', frameNumber };
    }
    case 'audio-segment': {
      const { startSecond, endSecond } = selection;
      if (
        startSecond === undefined ||
        endSecond === undefined ||
        startSecond < 0 ||
        endSecond <= startSecond
      ) {
        throw new CoreError(
          'INVALID_SELECTION',
          'seleção de segmento de áudio exige 0 <= início < fim (segundos)',
        );
      }
      return { kind: 'audio-segment', startSecond, endSecond };
    }
  }
}

/**
 * Sessão da tagging interface exibida no browser melhorado: recebe as tags
 * criadas pelo usuário sobre porções do conteúdo externo.
 */
export interface TaggingSession {
  /** Identificador determinístico (ex.: "tagging-1"). */
  id: string;
  /** Label do conteúdo externo tagueado nesta sessão. */
  contentLabel: string;
  user: string;
  /** Seleciona uma porção do conteúdo (validada conforme o tipo). */
  selectPortion(selection: ContentSelection): ContentSelection;
  /** Cria a tag associada à porção tagueada e a registra na sessão. */
  createTag(input: CreateTagInput, selection?: ContentSelection): Tag;
  /** Modifica título e/ou tipo de uma tag já criada. */
  modifyTag(tagId: string, changes: { title?: string; type?: string }): Tag;
  /** Lista as tags recebidas pela sessão. */
  tags(): Tag[];
  getTag(tagId: string): Tag | undefined;
}

export interface TaggingSessionDeps {
  clock?: Clock;
  nextId?: IdGenerator;
  user?: string;
}

/**
 * Abre a tagging interface sobre um conteúdo externo (cópia local melhorada).
 * DateAdded das tags vem do clock injetável; ids vêm do gerador injetável.
 */
export function createTaggingSession(
  content: ExternalContent,
  deps: TaggingSessionDeps = {},
): TaggingSession {
  const clock = deps.clock ?? createDeterministicClock();
  const nextId = deps.nextId ?? createIdGenerator();
  const user = deps.user ?? 'anonymous';
  const session: Tag[] = [];
  let currentSelection: ContentSelection | undefined;
  const id = nextId('tagging');

  return {
    id,
    contentLabel: content.label,
    user,
    selectPortion(selection: ContentSelection): ContentSelection {
      currentSelection = validateSelection(selection);
      return currentSelection;
    },
    createTag(input: CreateTagInput, selection?: ContentSelection): Tag {
      if (!TAG_OPTIONS.includes(input.tagOption)) {
        throw new CoreError(
          'INVALID_TAG_OPTION',
          `tagOption deve ser uma de: ${TAG_OPTIONS.join(', ')}`,
        );
      }
      if (input.title.trim() === '') {
        throw new CoreError('INVALID_TITLE', 'título da tag não pode ser vazio');
      }
      if (input.type.trim() === '') {
        throw new CoreError('INVALID_TYPE', 'tipo da tag não pode ser vazio');
      }
      const portion = selection !== undefined ? validateSelection(selection) : currentSelection;
      if (portion === undefined) {
        throw new CoreError(
          'SELECTION_REQUIRED',
          'selecione uma porção do conteúdo antes de criar a tag',
        );
      }
      const tag: Tag = {
        id: nextId('tag'),
        tagOption: input.tagOption,
        title: input.title,
        type: input.type,
        contentLabel: content.label,
        dateAdded: clock(),
        user,
        selection: portion,
      };
      session.push(tag);
      return tag;
    },
    modifyTag(tagId: string, changes: { title?: string; type?: string }): Tag {
      const tag = session.find((candidate) => candidate.id === tagId);
      if (tag === undefined) {
        throw new CoreError('TAG_NOT_FOUND', `tag não encontrada na sessão: ${tagId}`);
      }
      if (changes.title !== undefined) {
        if (changes.title.trim() === '') {
          throw new CoreError('INVALID_TITLE', 'título da tag não pode ser vazio');
        }
        tag.title = changes.title;
      }
      if (changes.type !== undefined) {
        if (changes.type.trim() === '') {
          throw new CoreError('INVALID_TYPE', 'tipo da tag não pode ser vazio');
        }
        tag.type = changes.type;
      }
      return tag;
    },
    tags(): Tag[] {
      return session.map((tag) => ({ ...tag, selection: { ...tag.selection } }));
    },
    getTag(tagId: string): Tag | undefined {
      return session.find((candidate) => candidate.id === tagId);
    },
  };
}
