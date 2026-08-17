/**
 * data-lineage — consume pipeline asset materializations into the event log.
 */
import type { LineageStore, PipelineRun, RecordPipelineRunInput } from 'contracts';

export function recordAssetMaterialization(
  store: LineageStore,
  input: RecordPipelineRunInput,
): PipelineRun {
  return store.recordRun(input);
}
