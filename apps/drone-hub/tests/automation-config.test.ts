import { describe, expect, test } from 'bun:test';
import { createAutomationConfig } from '../src/droneHub/app/automation-config';

describe('automation config normalization', () => {
  test('keeps modern sleepAmount/sleepUnit fields', () => {
    const cfg = createAutomationConfig({
      label: 'Modern',
      sleepAmount: 8,
      sleepUnit: 'hours',
    });
    expect(cfg.sleepAmount).toBe(8);
    expect(cfg.sleepUnit).toBe('hours');
  });

  test('migrates legacy sleepBetweenRunsSeconds to sleepAmount/sleepUnit', () => {
    const legacySeed: any = {
      label: 'Legacy',
      // Legacy persisted shape (pre sleepAmount/sleepUnit).
      sleepBetweenRunsSeconds: 8 * 60 * 60,
    };
    const cfg = createAutomationConfig(legacySeed);
    expect(cfg.sleepAmount).toBe(8);
    expect(cfg.sleepUnit).toBe('hours');
  });

  test('prefers modern fields when both modern and legacy values exist', () => {
    const mixedSeed: any = {
      label: 'Both',
      sleepAmount: 5,
      sleepUnit: 'minutes',
      sleepBetweenRunsSeconds: 8 * 60 * 60,
    };
    const cfg = createAutomationConfig(mixedSeed);
    expect(cfg.sleepAmount).toBe(5);
    expect(cfg.sleepUnit).toBe('minutes');
  });
});
