import { describe, expect, test } from 'bun:test';
import { RIGHT_PANEL_TABS, RIGHT_PANEL_TAB_LABELS } from '../src/droneHub/app/app-config';

describe('fleet tab config', () => {
  test('exposes fleet in the right panel tab set', () => {
    expect(RIGHT_PANEL_TABS).toContain('fleet');
    expect(RIGHT_PANEL_TAB_LABELS.fleet).toBe('Fleet');
  });

  test('keeps assistant files inside the assistant tab', () => {
    expect(RIGHT_PANEL_TABS).toContain('assistant');
    expect(RIGHT_PANEL_TABS).not.toContain('artifacts');
    expect(RIGHT_PANEL_TAB_LABELS.assistant).toBe('Assistant');
  });
});
