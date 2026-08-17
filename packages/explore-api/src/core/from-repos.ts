/**
 * explore-api — src/core/from-repos.ts
 * Carrega um catálogo a partir dos repositórios canônicos.
 */

import type { LinkRecord, LinkRepository, ObjectRecord, ObjectRepository } from 'contracts';

import type { ExploreCatalog } from './catalog.js';

async function asArray<T>(v: T[] | Promise<T[]>): Promise<T[]> {
  return await v;
}

export async function catalogFromRepos(opts: {
  ontologyId: string;
  objectTypeIds: readonly string[];
  objects: ObjectRepository;
  links: LinkRepository;
}): Promise<ExploreCatalog> {
  const objects: ObjectRecord[] = [];
  const links: LinkRecord[] = [];
  const seenLink = new Set<string>();

  for (const typeId of opts.objectTypeIds) {
    const listed = await asArray(opts.objects.list(opts.ontologyId, typeId));
    for (const o of listed) {
      if (o.deleted) continue;
      objects.push(o);
      const from = await asArray(
        opts.links.listFrom(opts.ontologyId, o.objectTypeId, o.primaryKey),
      );
      for (const e of from) {
        if (e.deleted || seenLink.has(e.id)) continue;
        seenLink.add(e.id);
        links.push(e);
      }
    }
  }

  return { objects, links };
}
