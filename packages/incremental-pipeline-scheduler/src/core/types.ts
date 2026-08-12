/**
 * incremental-pipeline-scheduler — src/core/types.ts
 */

import type { BuildStatus, DatasetKind, DependencyKind } from 'contracts';

export type Clock = () => string;
export type IdGenerator = (prefix: string) => string;

export interface DatasetNode {
  id: string;
  name: string;
  kind: DatasetKind;
  version: number;
  buildStatus: BuildStatus;
  critical: boolean;
  groupId?: string;
  groupDependencyKind?: DependencyKind;
  updatedAt: string;
  /** content hash / payload marker for gate demos. */
  contentHash: string;
}

export interface CreateSchedulerOptions {
  clock?: Clock;
  nextId?: IdGenerator;
  /** Idade máxima (ms lógicos via clock ticks) para considerar stale — opcional. */
  staleAfterMs?: number;
  /** Callback de build determinístico (default: bump version + hash). */
  build?: BuildHandler;
}

export type BuildHandler = (args: {
  target: DatasetNode;
  sources: DatasetNode[];
  clock: Clock;
}) => { contentHash: string };
