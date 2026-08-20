/**
 * platform-api — AipObjectReader over SecuredReads + graph (ADR-0022).
 */

import type { AipObjectReader } from 'contracts';

import type { PublicPlatformContext } from './context.js';
import { createSecuredReads } from './secured-reads.js';

export function createAipObjectReader(ctx: PublicPlatformContext): AipObjectReader {
  const reads = createSecuredReads(ctx);

  return {
    async listObjectTypes(principal, ontologyId) {
      const latest = await ctx.ontology.getLatestVersion(ontologyId);
      if (!latest) return [];
      const ids = Object.keys(latest.objectTypes);
      return ids.filter((id) => reads.canRead(principal, ontologyId, id));
    },

    async getObject(principal, ontologyId, objectTypeId, primaryKey) {
      const obj = await reads.getObject(principal, ontologyId, objectTypeId, primaryKey);
      if (!obj) return undefined;
      return {
        objectTypeId: obj.objectTypeId,
        primaryKey: obj.primaryKey,
        properties: { ...obj.properties },
      };
    },

    async loadObjectSet(principal, ontologyId, objectTypeId, limit) {
      const listed = await reads.listObjects(principal, ontologyId, objectTypeId);
      return listed.slice(0, limit).map((o) => ({
        objectTypeId: o.objectTypeId,
        primaryKey: o.primaryKey,
        properties: { ...o.properties },
      }));
    },

    async graphNeighbors(principal, ontologyId, objectTypeId, primaryKey, linkTypeId) {
      if (!reads.canRead(principal, ontologyId, objectTypeId)) return [];
      const out: Array<{ objectTypeId: string; primaryKey: string; linkTypeId: string }> = [];
      const seen = new Set<string>();

      for (const edge of await ctx.links.listFrom(ontologyId, objectTypeId, primaryKey)) {
        if (linkTypeId && edge.linkTypeId !== linkTypeId) continue;
        if (!reads.canRead(principal, ontologyId, edge.targetObjectTypeId)) continue;
        const k = `${edge.linkTypeId}:${edge.targetObjectTypeId}:${edge.targetPrimaryKey}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          objectTypeId: edge.targetObjectTypeId,
          primaryKey: edge.targetPrimaryKey,
          linkTypeId: edge.linkTypeId,
        });
      }
      for (const edge of await ctx.links.listTo(ontologyId, objectTypeId, primaryKey)) {
        if (linkTypeId && edge.linkTypeId !== linkTypeId) continue;
        if (!reads.canRead(principal, ontologyId, edge.sourceObjectTypeId)) continue;
        const k = `${edge.linkTypeId}:${edge.sourceObjectTypeId}:${edge.sourcePrimaryKey}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          objectTypeId: edge.sourceObjectTypeId,
          primaryKey: edge.sourcePrimaryKey,
          linkTypeId: edge.linkTypeId,
        });
      }
      return out;
    },
  };
}
