/**
 * ontology-registry — src/core/types.ts
 */

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface CreateOntologyRegistryOptions {
  clock?: Clock;
  nextId?: IdGenerator;
}
