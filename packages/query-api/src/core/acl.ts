/**
 * query-api — src/core/acl.ts
 * Fail-closed: sem ACL → invisível. Classificação no doc e na propriedade.
 */

import { canViewAtLevel } from 'contracts';
import type { SearchDocument, SearchPrincipal } from 'contracts';

export function principalsOf(user: SearchPrincipal): string[] {
  return [user.id, ...(user.groups ?? [])];
}

export function hasAcl(doc: SearchDocument, user: SearchPrincipal): boolean {
  if (!doc.aclPrincipals || doc.aclPrincipals.length === 0) return false;
  const mine = new Set(principalsOf(user));
  return doc.aclPrincipals.some((p) => mine.has(p));
}

export function canViewDocument(doc: SearchDocument, user: SearchPrincipal): boolean {
  if (!hasAcl(doc, user)) return false;
  return canViewAtLevel(doc.classification, user.viewingLevel);
}

export function propertyMark(doc: SearchDocument, property: string): string | undefined {
  return doc.propertyClassifications?.[property] ?? doc.classification;
}

export function canViewProperty(
  doc: SearchDocument,
  property: string,
  user: SearchPrincipal,
): boolean {
  if (!canViewDocument(doc, user)) return false;
  return canViewAtLevel(propertyMark(doc, property), user.viewingLevel);
}

export function visibleProperties(
  doc: SearchDocument,
  user: SearchPrincipal,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.properties)) {
    if (canViewProperty(doc, k, user)) out[k] = v;
  }
  return out;
}
