/**
 * object-platform — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateObjectPlatformOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /**
   * authorize injetável (Passo 16).
   * Default: allow tudo (útil em unit tests isolados).
   */
  authorize?: import('contracts').AuthorizeFn;
}
