/**
 * Passo 3 / EP4660856 (gestao de seguranca de software):
 * DependencyInventory — parseia package-lock.json (lockfileVersion 2 ou 3)
 * e produz o inventario de dependencias do artefato, marcando cada pacote
 * como direto ou transitivo. E a entrada do VulnerabilityScanner no CI.
 */
import { readFileSync } from 'node:fs';

export type DependencyKind = 'direct' | 'transitive';

export interface Dependency {
  name: string;
  version: string;
  ecosystem: 'npm';
  kind: DependencyKind;
}

interface LockPackageEntry {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  dev?: boolean;
}

interface LockfileV2V3 {
  lockfileVersion?: number;
  packages?: Record<string, LockPackageEntry>;
  dependencies?: Record<string, LockPackageEntry>; // secao legada do v2
}

/** Extrai o nome do pacote a partir da chave "node_modules/<nome>". */
function nameFromPath(path: string): string | null {
  const idx = path.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  return path.slice(idx + 'node_modules/'.length) || null;
}

export class DependencyInventory {
  readonly dependencies: Dependency[] = [];

  static fromLockfile(lockfilePath: string): DependencyInventory {
    const raw = readFileSync(lockfilePath, 'utf8');
    return DependencyInventory.fromLockfileText(raw);
  }

  static fromLockfileText(text: string): DependencyInventory {
    let lock: LockfileV2V3;
    try {
      lock = JSON.parse(text) as LockfileV2V3;
    } catch (err) {
      throw new Error(`package-lock.json invalido: ${(err as Error).message}`);
    }
    const version = lock.lockfileVersion ?? 1;
    if (version < 2) {
      throw new Error(
        `lockfileVersion ${version} nao suportada (apenas v2/v3 do npm).`,
      );
    }
    const inv = new DependencyInventory();
    const seen = new Map<string, Dependency>();

    // Conjunto de dependencias diretas declaradas no pacote raiz (packages[""]).
    const directNames = new Set<string>();
    const root = lock.packages?.[''];
    for (const section of [root?.dependencies, root?.devDependencies, root?.optionalDependencies]) {
      if (section) for (const name of Object.keys(section)) directNames.add(name);
    }

    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
      if (path === '') continue; // raiz
      const name = nameFromPath(path);
      if (!name || !entry.version) continue;
      const dep: Dependency = {
        name,
        version: entry.version,
        ecosystem: 'npm',
        kind: directNames.has(name) ? 'direct' : 'transitive',
      };
      // Node_modules aninhados: a primeira ocorrencia (topo) prevalece.
      if (!seen.has(`${name}@${entry.version}`)) {
        seen.set(`${name}@${entry.version}`, dep);
        inv.dependencies.push(dep);
      }
    }
    inv.dependencies.sort((a, b) => a.name.localeCompare(b.name));
    return inv;
  }

  get direct(): Dependency[] {
    return this.dependencies.filter((d) => d.kind === 'direct');
  }

  get transitive(): Dependency[] {
    return this.dependencies.filter((d) => d.kind === 'transitive');
  }
}