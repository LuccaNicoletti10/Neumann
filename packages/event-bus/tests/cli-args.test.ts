/**
 * event-bus — CLI argv parsing. A leaked `--` must not replace `gate`.
 */
import { describe, expect, it } from 'vitest';

import { isEventBusCommand, parseEventBusArgs } from '../src/cli-args.js';
import { runGateScenario } from '../src/gate.js';

describe('parseEventBusArgs', () => {
  it('reads gate as the command', () => {
    expect(parseEventBusArgs(['gate'])).toEqual({ command: 'gate', rest: [] });
    expect(isEventBusCommand('gate')).toBe(true);
  });

  it('ignores a leaked pnpm `--` separator so gate still runs', () => {
    expect(parseEventBusArgs(['--', 'gate'])).toEqual({ command: 'gate', rest: [] });
    expect(parseEventBusArgs(['gate', '--'])).toEqual({ command: 'gate', rest: [] });
  });

  it('does not treat `--` as a command', () => {
    expect(parseEventBusArgs(['--'])).toEqual({ command: undefined, rest: [] });
    expect(isEventBusCommand('--')).toBe(false);
    expect(isEventBusCommand(undefined)).toBe(false);
  });
});

describe('gate command', () => {
  it('runGateScenario is the gate body and exits 0', async () => {
    await expect(runGateScenario()).resolves.toBe(0);
  });
});
