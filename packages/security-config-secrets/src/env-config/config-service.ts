/**
 * Passo 3 / US20250298632A1 (config de ambiente editavel remotamente):
 * ConfigServer — lado remoto que guarda os config files por ambiente
 * (envs/<name>.config.json), aplica instructions validando offsets contra
 * o indice atual (arquivo modificado externamente => conflito) e mantem
 * version control: historico {version, appliedAt, instructions, author},
 * com get(version) e diff entre versoes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ConfigIndexer, type IndexedConfig } from './config-indexer.js';
import { applyInstructions, type EditInstruction } from './change-computer.js';
import { parseJsonWithOffsets } from './json-offsets.js';

export interface ConfigVersion {
  version: number;
  appliedAt: string; // ISO 8601
  instructions: EditInstruction[];
  author: string;
  /** Snapshot do texto nesta versao (permite get(version) e diff). */
  text: string;
}

export class VersionConflictError extends Error {
  constructor(
    message: string,
    readonly currentVersion: number,
    readonly baseVersion: number,
  ) {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class EnvNotFoundError extends Error {
  constructor(name: string) {
    super(`ambiente nao encontrado: "${name}"`);
    this.name = 'EnvNotFoundError';
  }
}

interface EnvState {
  name: string;
  text: string;
  indexed: IndexedConfig;
  versions: ConfigVersion[];
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export class ConfigServer {
  private readonly indexer = new ConfigIndexer();
  private readonly envs = new Map<string, EnvState>();

  constructor(private readonly rootDir: string) {
    mkdirSync(this.envsDir, { recursive: true });
  }

  private get envsDir(): string {
    return join(this.rootDir, 'envs');
  }

  private fileFor(name: string): string {
    return join(this.envsDir, `${name}.config.json`);
  }

  private historyFileFor(name: string): string {
    return join(this.envsDir, `${name}.history.json`);
  }

  listEnvs(): string[] {
    const names = new Set<string>(this.envs.keys());
    if (existsSync(this.envsDir)) {
      for (const f of readdirSafe(this.envsDir)) {
        const m = /^(.*)\.config\.json$/.exec(f);
        if (m?.[1]) names.add(m[1]);
      }
    }
    return [...names].sort();
  }

  /**
   * Cria/atualiza o config de um ambiente. O historico e persistido em
   * envs/<name>.history.json: se o texto divergir do ultimo snapshot,
   * uma nova versao e acrescentada (carga inicial = versao 1).
   */
  putConfig(name: string, text: string, author = 'system'): EnvState {
    const indexed = this.indexer.index(text); // valida o JSON
    const versions = this.loadHistory(name);
    const last = versions[versions.length - 1];
    if (!last || last.text !== text) {
      versions.push({
        version: (last?.version ?? 0) + 1,
        appliedAt: new Date().toISOString(),
        instructions: [],
        author,
        text,
      });
    }
    const state: EnvState = { name, text, indexed, versions };
    this.envs.set(name, state);
    this.persist(state);
    return state;
  }

  private loadHistory(name: string): ConfigVersion[] {
    const file = this.historyFileFor(name);
    if (!existsSync(file)) return [];
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ConfigVersion[];
    } catch {
      return [];
    }
  }

  private load(name: string): EnvState {
    const cached = this.envs.get(name);
    const file = this.fileFor(name);
    if (cached) {
      // Se o arquivo em disco divergir do texto em memoria, alguem editou
      // fora do servidor: recarrega como novo estado (deteccao de drift).
      if (existsSync(file) && sha256(readFileSync(file, 'utf8')) !== sha256(cached.text)) {
        return this.putConfig(name, readFileSync(file, 'utf8'), 'external');
      }
      return cached;
    }
    if (!existsSync(file)) throw new EnvNotFoundError(name);
    return this.putConfig(name, readFileSync(file, 'utf8'), 'loaded');
  }

  getConfig(name: string): { text: string; indexed: IndexedConfig; version: number } {
    const state = this.load(name);
    return { text: state.text, indexed: state.indexed, version: currentVersion(state) };
  }

  /**
   * Aplica instructions ao ambiente. Rejeita com VersionConflictError se
   * baseVersion nao for a versao atual ou se algum offset nao casar com um
   * no folha do indice atual (arquivo alterado desde a indexacao).
   */
  apply(
    name: string,
    instructions: EditInstruction[],
    baseVersion: number,
    author = 'anonymous',
    now: Date = new Date(),
  ): ConfigVersion {
    const state = this.load(name);
    const current = currentVersion(state);
    if (baseVersion !== current) {
      throw new VersionConflictError(
        `conflito de versao: base=${baseVersion}, atual=${current}`,
        current,
        baseVersion,
      );
    }
    this.validateInstructions(state, instructions);
    const newText = applyInstructions(state.text, instructions);
    // O resultado precisa continuar JSON valido (com comentarios).
    parseJsonWithOffsets(newText);
    const version: ConfigVersion = {
      version: current + 1,
      appliedAt: now.toISOString(),
      instructions,
      author,
      text: newText,
    };
    state.text = newText;
    state.indexed = this.indexer.index(newText);
    state.versions.push(version);
    this.persist(state);
    return version;
  }

  /** Cada instruction precisa corresponder a um no folha do indice atual. */
  private validateInstructions(state: EnvState, instructions: EditInstruction[]): void {
    for (const ins of instructions) {
      const node = state.indexed.byPath.get(ins.path);
      if (!node || node.start !== ins.locationId.start || node.end !== ins.locationId.end) {
        throw new VersionConflictError(
          `instruction para "${ins.path}" nao casa o indice atual ` +
            `(offsets [${ins.locationId.start}, ${ins.locationId.end}) invalidos)`,
          currentVersion(state),
          currentVersion(state),
        );
      }
    }
  }

  history(name: string): ConfigVersion[] {
    return [...this.load(name).versions];
  }

  getVersion(name: string, version: number): ConfigVersion {
    const state = this.load(name);
    const v = state.versions.find((x) => x.version === version);
    if (!v) throw new Error(`versao ${version} inexistente para "${name}"`);
    return v;
  }

  /** Diff linha a linha (LCS) entre duas versoes. */
  diff(name: string, fromVersion: number, toVersion: number): DiffLine[] {
    const a = this.getVersion(name, fromVersion).text.split('\n');
    const b = this.getVersion(name, toVersion).text.split('\n');
    return diffLines(a, b);
  }

  private persist(state: EnvState): void {
    writeFileSync(this.fileFor(state.name), state.text, 'utf8');
    writeFileSync(this.historyFileFor(state.name), JSON.stringify(state.versions, null, 2), 'utf8');
  }
}

function currentVersion(state: EnvState): number {
  return state.versions[state.versions.length - 1]?.version ?? 0;
}

function readdirSafe(dir: string): string[] {
  try {
    return Array.from(readdirSync(dir));
  } catch {
    return [];
  }
}

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  line: string;
}

/** Diff linha a linha via LCS (arquivos pequenos de config). */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // Tabela LCS.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? (dp[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', line: a[i]! });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ type: 'del', line: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', line: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', line: a[i++]! });
  while (j < m) out.push({ type: 'add', line: b[j++]! });
  return out;
}