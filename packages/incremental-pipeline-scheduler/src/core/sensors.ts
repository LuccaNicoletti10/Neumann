/**
 * incremental-pipeline-scheduler — sensors (dataset_changed / cron / webhook).
 */
import type { SensorDef } from 'contracts';

export interface SensorRuntime {
  defs: SensorDef[];
  fired: Map<string, number>;
  lastError?: string;
}

export function createSensorRuntime(defs: SensorDef[] = []): SensorRuntime {
  return { defs: [...defs], fired: new Map() };
}

export function addSensor(rt: SensorRuntime, def: SensorDef): void {
  rt.defs.push(def);
}

export function onDatasetChanged(rt: SensorRuntime, datasetId: string): string[] {
  const targets: string[] = [];
  for (const s of rt.defs) {
    if (s.kind !== 'dataset_changed' || s.datasetId !== datasetId) continue;
    const key = `${s.id}:${datasetId}`;
    if (rt.fired.has(key)) continue;
    rt.fired.set(key, 1);
    targets.push(s.target);
  }
  return targets;
}

export function fireCron(rt: SensorRuntime, nowIso: string): string[] {
  void nowIso;
  return rt.defs.filter((s) => s.kind === 'cron').map((s) => s.target);
}

export function fireWebhook(rt: SensorRuntime, sensorId: string): string[] {
  const s = rt.defs.find((d) => d.id === sensorId && d.kind === 'webhook');
  return s ? [s.target] : [];
}
