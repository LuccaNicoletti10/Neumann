/**
 * policy-engine — src/core/closed-channels.ts
 * Embeddings e LLM não são produto do kernel (M8). Canal fail-closed:
 * recurso negado ≡ inexistente → vetor vazio / completion vazia.
 * Nunca embedar/completar texto não autorizado.
 */

export type ChannelAccess = (principal: string, resourceId: string) => boolean;

const EMPTY_VECTOR: readonly number[] = Object.freeze([]);

export function embedAuthorized(
  canRead: ChannelAccess,
  principal: string,
  resourceId: string,
  text: string,
): readonly number[] {
  if (!canRead(principal, resourceId)) return EMPTY_VECTOR;
  // Kernel: sem modelo. Autorizado → fingerprint numérico estável do texto (não é embedding de produto).
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return [h >>> 0];
}

export function completeAuthorized(
  canRead: ChannelAccess,
  principal: string,
  resourceId: string,
  _prompt: string,
): string {
  if (!canRead(principal, resourceId)) return '';
  return '';
}
