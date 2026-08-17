import { describe, expect, it } from 'vitest';

import { addSensor, createSensorRuntime, fireWebhook, onDatasetChanged } from '../src/core/sensors.js';

describe('sensors', () => {
  it('dataset_changed fires once (idempotent)', () => {
    const rt = createSensorRuntime([
      { id: 's1', kind: 'dataset_changed', target: 'pipe-1', datasetId: 'A' },
    ]);
    expect(onDatasetChanged(rt, 'A')).toEqual(['pipe-1']);
    expect(onDatasetChanged(rt, 'A')).toEqual([]);
  });

  it('broken webhook sensor is visible, no loop', () => {
    const rt = createSensorRuntime();
    addSensor(rt, { id: 'w1', kind: 'webhook', target: 'missing-pipe' });
    expect(fireWebhook(rt, 'w1')).toEqual(['missing-pipe']);
    expect(fireWebhook(rt, 'nope')).toEqual([]);
  });
});
