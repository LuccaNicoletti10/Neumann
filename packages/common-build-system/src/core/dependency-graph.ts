import { BuildManifest } from "../types";

export class DependencyCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Ciclo de dependências detectado: ${cycle.join(" -> ")}`);
    this.name = "DependencyCycleError";
  }
}

export class UnknownDependencyError extends Error {
  constructor(product: string, dep: string) {
    super(`Produto '${product}' depende de '${dep}', que não existe no monorepo`);
    this.name = "UnknownDependencyError";
  }
}

export function topoSort(manifests: BuildManifest[]): BuildManifest[] {
  const byName = new Map(manifests.map((m) => [m.name, m]));
  for (const m of manifests) {
    for (const dep of m.deps) {
      if (!byName.has(dep)) throw new UnknownDependencyError(m.name, dep);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(manifests.map((m) => [m.name, WHITE]));
  const order: BuildManifest[] = [];
  const stack: string[] = [];

  const visit = (m: BuildManifest): void => {
    color.set(m.name, GRAY);
    stack.push(m.name);
    for (const depName of m.deps) {
      const dep = byName.get(depName);
      if (!dep) continue;
      const c = color.get(depName);
      if (c === GRAY) {
        const cycleStart = stack.indexOf(depName);
        throw new DependencyCycleError([...stack.slice(cycleStart), depName]);
      }
      if (c === WHITE) visit(dep);
    }
    stack.pop();
    color.set(m.name, BLACK);
    order.push(m);
  };

  for (const m of manifests) {
    if (color.get(m.name) === WHITE) visit(m);
  }
  return order;
}

export function buildOrderFor(manifests: BuildManifest[], target: string): BuildManifest[] {
  const byName = new Map(manifests.map((m) => [m.name, m]));
  if (!byName.has(target)) {
    throw new Error(`Produto desconhecido: '${target}'`);
  }
  const needed = new Set<string>();
  const walk = (name: string): void => {
    if (needed.has(name)) return;
    needed.add(name);
    const m = byName.get(name);
    if (!m) throw new UnknownDependencyError(target, name);
    for (const dep of m.deps) walk(dep);
  };
  walk(target);
  return topoSort(manifests.filter((m) => needed.has(m.name)));
}
