/**
 * external-content-exporter — src/core/content.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: ACESSO A CONTEÚDO EXTERNO E
 * ENHANCE DO BROWSER — conteúdo externo ao internal database system, servido
 * por um server externo via network, é acessado (aberto ou modificado) por
 * meio do web browser; a ativação do bookmarklet reescreve/modifica parte do
 * código da página e melhora a cópia local do conteúdo, que é armazenada sob
 * um label no cache/diretório associado à tagging interface. Nenhum texto dos
 * claims é reproduzido; apenas a funcionalidade é reimplementada de forma
 * original.
 */

import { createIdGenerator } from './determinism.js';
import { CoreError } from './types.js';
import type { ExternalContent, ExternalContentType, IdGenerator } from './types.js';

/** Tipos de conteúdo externo suportados pelo acesso via web browser. */
export const CONTENT_TYPES: readonly ExternalContentType[] = [
  'web-page',
  'document',
  'pdf',
  'audio',
  'video',
  'image',
  'email',
  'form',
];

/** Resposta de um server externo ao servir conteúdo via network. */
export interface ExternalServerResponse {
  body: string;
  contentType: ExternalContentType;
  /** Server externo de origem (ex.: "externo.example.com"). */
  sourceServer: string;
}

/**
 * Transporte injetável que simula a network entre o web browser e o server
 * externo. O default é determinístico (deriva tudo da URL).
 */
export type ExternalTransport = (url: string) => ExternalServerResponse;

/** Infere o tipo de conteúdo a partir da extensão/caminho da URL. */
export function inferContentType(url: string): ExternalContentType {
  const path = url.split('?')[0] ?? url;
  const extension = path.includes('.') ? (path.split('.').pop() ?? '').toLowerCase() : '';
  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'mp3':
    case 'wav':
    case 'ogg':
      return 'audio';
    case 'mp4':
    case 'webm':
    case 'mov':
      return 'video';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
      return 'image';
    case 'eml':
      return 'email';
    case 'form':
      return 'form';
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
      return 'document';
    default:
      return 'web-page';
  }
}

/** Transporte default determinístico: sintetiza o corpo a partir da URL. */
export function defaultTransport(url: string): ExternalServerResponse {
  let host = 'server-externo';
  try {
    host = new URL(url).host;
  } catch {
    // URL relativa: mantém o host default determinístico.
  }
  const contentType = inferContentType(url);
  return {
    body: `conteúdo externo (${contentType}) servido por ${host} em ${url}`,
    contentType,
    sourceServer: host,
  };
}

/** Modelo mínimo de web browser: mantém o conteúdo externo atualmente aberto. */
export interface WebBrowser {
  name: string;
  /** Conteúdo externo aberto/modificado no momento. */
  current(): ExternalContent | undefined;
  /** Abre (ou modifica) um conteúdo externo no browser. */
  open(content: ExternalContent): void;
  /** Fecha o conteúdo atual. */
  close(): void;
}

/** Cria o modelo de web browser usado para acessar o conteúdo externo. */
export function createWebBrowser(name = 'generic-browser'): WebBrowser {
  let current: ExternalContent | undefined;
  return {
    name,
    current(): ExternalContent | undefined {
      return current;
    },
    open(content: ExternalContent): void {
      current = content;
    },
    close(): void {
      current = undefined;
    },
  };
}

export interface AccessDeps {
  transport?: ExternalTransport;
  nextId?: IdGenerator;
}

/**
 * Acessa conteúdo EXTERNO ao internal database system por meio do web browser:
 * o conteúdo é servido por um server externo via network e aberto (ou
 * modificado) no browser, ganhando id e label determinísticos.
 */
export function accessExternalContent(
  browser: WebBrowser,
  url: string,
  deps: AccessDeps = {},
): ExternalContent {
  if (url.trim() === '') {
    throw new CoreError('INVALID_URL', 'URL do conteúdo externo não pode ser vazia');
  }
  const transport = deps.transport ?? defaultTransport;
  const nextId = deps.nextId ?? createIdGenerator();
  const response = transport(url);
  if (!CONTENT_TYPES.includes(response.contentType)) {
    throw new CoreError(
      'INVALID_CONTENT_TYPE',
      `tipo de conteúdo não suportado: ${String(response.contentType)}`,
    );
  }
  const id = nextId('content');
  const content: ExternalContent = {
    id,
    label: id,
    url,
    contentType: response.contentType,
    body: response.body,
    sourceServer: response.sourceServer,
  };
  browser.open(content);
  return content;
}

/**
 * Cópia local do conteúdo melhorada (enhanced): parte do código da página é
 * reescrita/modificada com marcação de suporte à seleção de porções.
 */
export interface EnhancedContent {
  content: ExternalContent;
  /** Marcação injetada que habilita a seleção de porções na tagging interface. */
  injectedMarkup: string;
  /** Comandos do bookmarklet/plug-in executados sobre a cópia local. */
  appliedCommands: string[];
  enhanced: true;
}

/** Marcação injetada na cópia local para dar suporte à seleção de porções. */
export const SELECTION_MARKUP =
  '<span data-tagging-support="selection" data-selection-kinds="text,image-region,video-frame,audio-segment"></span>';

/**
 * Melhora a cópia local do conteúdo exibido no browser: reescreve/modifica
 * parte do código da página injetando marcação de suporte à seleção.
 */
export function enhanceLocalCopy(
  content: ExternalContent,
  appliedCommands: readonly string[] = [],
): EnhancedContent {
  const enhanced: ExternalContent = {
    ...content,
    body: `${content.body}\n${SELECTION_MARKUP}`,
  };
  return {
    content: enhanced,
    injectedMarkup: SELECTION_MARKUP,
    appliedCommands: [...appliedCommands],
    enhanced: true,
  };
}

/** Visão mínima do cache local de conteúdos (implementado pelo tag store). */
export interface ContentCacheLike {
  storeContent(label: string, content: ExternalContent): void;
}

/**
 * Armazena o conteúdo externo sob um label no cache/diretório local associado
 * à tagging interface (memória do electronic device ou cache do browser).
 */
export function labelContent(
  content: ExternalContent,
  cache: ContentCacheLike,
  label?: string,
): string {
  const effectiveLabel = label ?? content.label;
  if (effectiveLabel.trim() === '') {
    throw new CoreError('INVALID_LABEL', 'label do conteúdo não pode ser vazio');
  }
  const labeled: ExternalContent = { ...content, label: effectiveLabel };
  cache.storeContent(effectiveLabel, labeled);
  return effectiveLabel;
}
