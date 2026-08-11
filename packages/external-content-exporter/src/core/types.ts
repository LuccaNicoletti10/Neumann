/**
 * external-content-exporter — src/core/types.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: TIPOS DO NÚCLEO — conteúdo
 * externo acessado via web browser, seleção de porção do conteúdo (texto,
 * região de imagem, frame de vídeo, segmento de áudio), tag criada na tagging
 * interface, pares parâmetro-valor, sessão de login e recibo de exportação.
 * Nenhum texto dos claims é reproduzido; apenas a funcionalidade é
 * reimplementada de forma original.
 */

/** Tipos de conteúdo externo acessíveis pelo web browser. */
export type ExternalContentType =
  | 'web-page'
  | 'document'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'image'
  | 'email'
  | 'form';

/**
 * Conteúdo EXTERNO ao internal database system, servido por um server externo
 * via network e acessado (aberto ou modificado) por meio do web browser.
 */
export interface ExternalContent {
  /** Identificador determinístico (ex.: "content-1"). */
  id: string;
  /** Rótulo sob o qual o conteúdo é armazenado no cache/diretório local. */
  label: string;
  /** URL de origem no server externo. */
  url: string;
  contentType: ExternalContentType;
  /** Corpo local do conteúdo (cópia mantida pelo browser). */
  body: string;
  /** Server externo que serviu o conteúdo via network. */
  sourceServer: string;
}

/** Formas de porção selecionável do conteúdo externo. */
export type SelectionKind = 'text' | 'image-region' | 'video-frame' | 'audio-segment';

/** Região retangular de uma imagem (coordenadas em pixels). */
export interface ImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Porção do conteúdo externo selecionada pelo usuário na tagging interface:
 * trecho de texto, região de imagem, frame de vídeo ou segmento de áudio.
 */
export interface ContentSelection {
  kind: SelectionKind;
  /** Offsets de caracteres (seleção de texto). */
  startOffset?: number;
  endOffset?: number;
  /** Coordenadas (seleção de região de imagem). */
  region?: ImageRegion;
  /** Número do frame (seleção em vídeo). */
  frameNumber?: number;
  /** Intervalo em segundos (seleção de segmento de áudio). */
  startSecond?: number;
  endSecond?: number;
}

/** Como a tag é classificada na ontology/object model do banco interno. */
export type TagOption = 'object' | 'property' | 'link';

/**
 * Tag criada na tagging interface e associada à porção tagueada do conteúdo.
 * `dateAdded` vem SEMPRE do clock injetável (determinismo total).
 */
export interface Tag {
  /** Identificador determinístico (ex.: "tag-1"). */
  id: string;
  tagOption: TagOption;
  title: string;
  type: string;
  /** Rótulo do conteúdo externo ao qual a tag se associa. */
  contentLabel: string;
  /** Carimbo de criação fornecido pelo clock injetável (ISO 8601). */
  dateAdded: string;
  /** Usuário criador da tag. */
  user: string;
  /** Porção do conteúdo tagueada. */
  selection: ContentSelection;
}

/** Nomes de parâmetro aceitos pela API do internal database system. */
export type ParameterName = 'TagOption' | 'Title' | 'Type' | 'Content' | 'DateAdded' | 'User';

/** Par parâmetro-valor criado via API a partir de uma tag. */
export interface ParameterValuePair {
  parameter: ParameterName;
  value: string;
}

/** Sessão autenticada exigida para exportar para o banco interno. */
export interface Session {
  /** Token determinístico (ex.: "session-1"). */
  token: string;
  user: string;
  /** Carimbo de criação fornecido pelo clock injetável (ISO 8601). */
  createdAt: string;
}

/** Combinações de armazenamento suportadas para tag/conteúdo. */
export type StorageCombination = 'external' | 'internal' | 'both';

/** Recibo emitido ao exportar uma tag (+ conteúdo) para o banco interno. */
export interface ExportReceipt {
  tagId: string;
  contentLabel: string;
  /** Quantidade de pares parâmetro-valor exportados. */
  pairCount: number;
  /** Identificador do data source que recebeu o conteúdo. */
  dataSourceId: string;
  /** Identificador do registro de pares no database. */
  recordId: string;
  /** Onde tag/conteúdo ficaram armazenados. */
  storage: StorageCombination;
  /** Carimbo da exportação fornecido pelo clock injetável (ISO 8601). */
  exportedAt: string;
}

/** Clock injetável: devolve o instante atual como string ISO 8601. */
export type Clock = () => string;

/** Gerador de ids injetável: devolve o próximo id para um prefixo. */
export type IdGenerator = (prefix: string) => string;

/** Erro de regra de negócio do núcleo, com código estável para testes. */
export class CoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CoreError';
  }
}
