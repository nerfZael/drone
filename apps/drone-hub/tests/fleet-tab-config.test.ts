import { describe, expect, test } from 'bun:test';
import { RIGHT_PANEL_TABS, RIGHT_PANEL_TAB_LABELS } from '../src/droneHub/app/app-config';

describe('fleet tab config', () => {
  test('exposes fleet in the right panel tab set', () => {
    expect(RIGHT_PANEL_TABS).toContain('fleet');
    expect(RIGHT_PANEL_TAB_LABELS.fleet).toBe('Fleet');
  });

  test('exposes assistant artifacts in the right panel tab set', () => {
    expect(RIGHT_PANEL_TABS).toContain('artifacts');
    expect(RIGHT_PANEL_TAB_LABELS.artifacts).toBe('Artifacts');
  });
});
