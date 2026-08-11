/**
 * external-content-exporter — src/core/exporter.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: EXPORTAÇÃO E CONVERSÃO —
 * pares parâmetro-valor (TagOption, Title, Type, Content=<label>, DateAdded do
 * clock, User) criados via API; interface de conversão que transforma pares +
 * conteúdo no formato compatível com o internal database system; botão de
 * export ("Export to Internal DB") que EXIGE login; alternativa AUTO-EXPORT em
 * que a criação da tag dispara a exportação automática; e flush da fila
 * pendente quando o device conecta/loga depois. Nenhum texto dos claims é
 * reproduzido; apenas a funcionalidade é reimplementada de forma original.
 */

import type { AuthService } from './auth.js';
import { createDeterministicClock } from './determinism.js';
import type { InternalDatabase } from './internalDb.js';
import type { TagStore } from './tagStore.js';
import { CoreError } from './types.js';
import type {
  Clock,
  ExportReceipt,
  ExternalContent,
  ParameterValuePair,
  Tag,
} from './types.js';

/** Formato compatível com o internal database system. */
export const INTERNAL_FORMAT = 'internal-db/v1';

/**
 * Cria os pares parâmetro-valor da tag, na ordem exata exigida pela API:
 * TagOption, Title, Type, Content (label), DateAdded (clock) e User.
 */
export function toParameterValuePairs(tag: Tag): ParameterValuePair[] {
  return [
    { parameter: 'TagOption', value: tag.tagOption },
    { parameter: 'Title', value: tag.title },
    { parameter: 'Type', value: tag.type },
    { parameter: 'Content', value: tag.contentLabel },
    { parameter: 'DateAdded', value: tag.dateAdded },
    { parameter: 'User', value: tag.user },
  ];
}

/** Pacote convertido, pronto para o internal database system. */
export interface InternalPackage {
  format: typeof INTERNAL_FORMAT;
  pairs: ParameterValuePair[];
  content: ExternalContent;
}

/**
 * Interface de conversão: transforma os pares parâmetro-valor + o conteúdo
 * externo no formato compatível com o internal database system.
 */
export function convertToInternalFormat(
  pairs: readonly ParameterValuePair[],
  content: ExternalContent,
): InternalPackage {
  if (pairs.length === 0) {
    throw new CoreError('CONVERSION_FAILED', 'conversão exige ao menos um par parâmetro-valor');
  }
  return {
    format: INTERNAL_FORMAT,
    pairs: pairs.map((pair) => ({ ...pair })),
    content: { ...content },
  };
}

export interface ExporterDeps {
  auth: AuthService;
  tagStore: TagStore;
  internalDb: InternalDatabase;
  clock?: Clock;
  /** AUTO-EXPORT: a criação da tag dispara a exportação automática. */
  autoExportOnCreate?: boolean;
}

/** Opções do botão de export ("Export to Internal DB"). */
export interface ExportOptions {
  /** Mantém cópia no externo após exportar (armazenamento "both"). */
  retainExternal?: boolean;
}

/**
 * Exportador: recebe tags da tagging interface, guarda no armazenamento local
 * e exporta (manual, automático ou por flush) para o internal database system.
 */
export interface Exporter {
  /** AUTO-EXPORT ligado? */
  readonly autoExport: boolean;
  /**
   * Recebe a tag criada: armazena localmente e, se AUTO-EXPORT estiver ligado
   * e houver sessão ativa, exporta automaticamente (devolve o recibo).
   */
  receiveTag(tag: Tag): ExportReceipt | undefined;
  /** Botão "Export to Internal DB": exporta tag + conteúdo (EXIGE login). */
  exportTag(token: string | undefined, tagId: string, options?: ExportOptions): ExportReceipt;
  /** Exporta toda a fila pendente (device conectou/logou depois). */
  flushPending(token: string | undefined, options?: ExportOptions): ExportReceipt[];
}

/** Cria o exportador com auth, armazenamento local e banco interno injetados. */
export function createExporter(deps: ExporterDeps): Exporter {
  const clock = deps.clock ?? createDeterministicClock();
  const autoExport = deps.autoExportOnCreate ?? false;

  function doExport(
    token: string | undefined,
    tag: Tag,
    options: ExportOptions,
  ): ExportReceipt {
    deps.auth.requireSession(token);
    const content = deps.tagStore.contentCache.getContent(tag.contentLabel);
    if (content === undefined) {
      throw new CoreError(
        'CONTENT_NOT_FOUND',
        `conteúdo não encontrado no cache local: ${tag.contentLabel}`,
      );
    }
    const internalPackage = convertToInternalFormat(toParameterValuePairs(tag), content);
    const dataSource = deps.internalDb.storeContent(internalPackage.content);
    const record = deps.internalDb.storePairs(internalPackage.pairs);
    deps.tagStore.markExported(tag.id);
    const storage = options.retainExternal === true ? 'both' : 'internal';
    deps.tagStore.setStorage(tag.id, storage);
    return {
      tagId: tag.id,
      contentLabel: tag.contentLabel,
      pairCount: internalPackage.pairs.length,
      dataSourceId: dataSource.id,
      recordId: record.id,
      storage,
      exportedAt: clock(),
    };
  }

  return {
    autoExport,
    receiveTag(tag: Tag): ExportReceipt | undefined {
      deps.tagStore.saveTag(tag);
      if (!autoExport) return undefined;
      const session = deps.auth.currentSession();
      if (session === undefined) return undefined;
      return doExport(session.token, tag, {});
    },
    exportTag(token: string | undefined, tagId: string, options: ExportOptions = {}): ExportReceipt {
      const tag = deps.tagStore.getTag(tagId);
      if (tag === undefined) {
        throw new CoreError('TAG_NOT_FOUND', `tag pendente não encontrada: ${tagId}`);
      }
      return doExport(token, tag, options);
    },
    flushPending(token: string | undefined, options: ExportOptions = {}): ExportReceipt[] {
      deps.auth.requireSession(token);
      const receipts: ExportReceipt[] = [];
      for (const tag of deps.tagStore.pendingQueue()) {
        receipts.push(doExport(token, tag, options));
      }
      return receipts;
    },
  };
}
