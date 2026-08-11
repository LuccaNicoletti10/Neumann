/**
 * external-content-exporter — src/core/bookmarklet.ts
 *
 * Reimplementação funcional INDEPENDENTE e original dos mecanismos da patente
 * US 10,809,888 B2 (Palantir, "Tagging Interface for External Content"). Este
 * arquivo implementa funcionalmente o componente: BOOKMARKLET — bookmark que
 * contém comandos JavaScript, instalado na barra de bookmarks de qualquer web
 * browser (browser-agnostic), com geração da URL "javascript:..."; alternativa
 * de plug-in específico por browser; ativação que melhora o browser exibindo a
 * tagging interface. Nenhum texto dos claims é reproduzido; apenas a
 * funcionalidade é reimplementada de forma original.
 */

import { createIdGenerator } from './determinism.js';
import type { IdGenerator } from './types.js';

/**
 * Bookmarklet: bookmark contendo uma sequência de comandos JavaScript.
 * Funciona em qualquer web browser (browser-agnostic).
 */
export interface Bookmarklet {
  /** Identificador determinístico (ex.: "bookmarklet-1"). */
  id: string;
  name: string;
  /** Comandos JavaScript que o bookmark contém. */
  commands: string[];
  /** URL "javascript:..." gerada a partir dos comandos. */
  url: string;
  kind: 'bookmarklet';
}

export interface BookmarkletDeps {
  nextId?: IdGenerator;
}

/** Monta a URL "javascript:..." a partir dos comandos do bookmark. */
export function buildBookmarkletUrl(commands: readonly string[]): string {
  if (commands.length === 0) {
    throw new Error('bookmarklet precisa de ao menos um comando JavaScript');
  }
  const script = commands.map((command) => command.trim()).join(';');
  return `javascript:${encodeURIComponent(script)}`;
}

/** Cria o modelo de bookmarklet (nome + comandos JavaScript → URL). */
export function createBookmarklet(
  name: string,
  commands: readonly string[],
  deps: BookmarkletDeps = {},
): Bookmarklet {
  if (name.trim() === '') {
    throw new Error('nome do bookmarklet não pode ser vazio');
  }
  const nextId = deps.nextId ?? createIdGenerator();
  return {
    id: nextId('bookmarklet'),
    name,
    commands: [...commands],
    url: buildBookmarkletUrl(commands),
    kind: 'bookmarklet',
  };
}

/** Formas de instalação do bookmarklet na barra de bookmarks. */
export type InstallMethod = 'drag-and-drop' | 'shortcut' | 'import';

/** Entrada instalada na barra de bookmarks do web browser. */
export interface BookmarkBarEntry {
  bookmarklet: Bookmarklet;
  method: InstallMethod;
  position: number;
}

/**
 * Barra de bookmarks de um web browser onde o bookmarklet é instalado por
 * arrastar-e-soltar (drag-and-drop), atalhos de teclado ou importação.
 */
export interface BookmarkBar {
  browser: string;
  install(bookmarklet: Bookmarklet, method?: InstallMethod): BookmarkBarEntry;
  entries(): BookmarkBarEntry[];
  find(name: string): BookmarkBarEntry | undefined;
}

export interface BookmarkBarDeps {
  browser?: string;
}

/** Cria a barra de bookmarks do browser (default: browser genérico). */
export function createBookmarkBar(deps: BookmarkBarDeps = {}): BookmarkBar {
  const installed: BookmarkBarEntry[] = [];
  return {
    browser: deps.browser ?? 'generic-browser',
    install(bookmarklet: Bookmarklet, method: InstallMethod = 'drag-and-drop'): BookmarkBarEntry {
      const entry: BookmarkBarEntry = { bookmarklet, method, position: installed.length + 1 };
      installed.push(entry);
      return entry;
    },
    entries(): BookmarkBarEntry[] {
      return [...installed];
    },
    find(name: string): BookmarkBarEntry | undefined {
      return installed.find((entry) => entry.bookmarklet.name === name);
    },
  };
}

/**
 * Alternativa ao bookmarklet: plug-in de browser, específico para cada browser
 * (ao contrário do bookmarklet, que é browser-agnostic).
 */
export interface BrowserPlugin {
  /** Identificador determinístico (ex.: "plugin-1"). */
  id: string;
  name: string;
  /** Browser específico ao qual o plug-in se aplica. */
  browser: string;
  commands: string[];
  kind: 'plugin';
}

export interface PluginDeps {
  nextId?: IdGenerator;
}

/** Cria o plug-in específico de um browser (alternativa ao bookmarklet). */
export function createPlugin(
  name: string,
  browser: string,
  commands: readonly string[],
  deps: PluginDeps = {},
): BrowserPlugin {
  if (browser.trim() === '') {
    throw new Error('plug-in precisa indicar o browser específico');
  }
  if (commands.length === 0) {
    throw new Error('plug-in precisa de ao menos um comando JavaScript');
  }
  const nextId = deps.nextId ?? createIdGenerator();
  return {
    id: nextId('plugin'),
    name,
    browser,
    commands: [...commands],
    kind: 'plugin',
  };
}

/** O que pode ser ativado no browser: bookmarklet (genérico) ou plug-in. */
export type BrowserExtension = Bookmarklet | BrowserPlugin;

/**
 * Resultado da ativação: o browser é melhorado (enhanced) e passa a exibir a
 * tagging interface; o retorno carrega os comandos a executar sobre a cópia
 * local do conteúdo.
 */
export interface Activation {
  extensionId: string;
  extensionKind: 'bookmarklet' | 'plugin';
  /** Comandos JavaScript que melhoram o browser/cópia local do conteúdo. */
  commands: string[];
  /** Indica que a tagging interface passou a ser exibida. */
  taggingInterfaceVisible: boolean;
}

/**
 * Ativa o bookmarklet (ou plug-in) no browser: melhora o browser exibindo a
 * tagging interface e habilita a modificação da cópia local do conteúdo.
 */
export function activate(extension: BrowserExtension): Activation {
  return {
    extensionId: extension.id,
    extensionKind: extension.kind,
    commands: [...extension.commands],
    taggingInterfaceVisible: true,
  };
}
