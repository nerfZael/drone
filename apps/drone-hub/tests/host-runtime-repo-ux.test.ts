import { describe, expect, test } from 'bun:test';
import {
  RIGHT_PANEL_TABS,
  repoUnavailableReasonForRuntime,
  rightPanelTabsForRuntime,
} from '../src/droneHub/app/app-config';

describe('host runtime repo UX safeguards', () => {
  test('keeps full right panel tabs for host runtime', () => {
    const tabs = rightPanelTabsForRuntime('host');
    expect(tabs).toContain('changes');
    expect(tabs).toContain('prs');
    expect(tabs).toContain('terminal');
    expect(tabs).toContain('files');
    expect(tabs).toEqual(RIGHT_PANEL_TABS);
  });

  test('keeps full right panel tabs for container runtime', () => {
    expect(rightPanelTabsForRuntime('container')).toEqual(RIGHT_PANEL_TABS);
    expect(rightPanelTabsForRuntime('')).toEqual(RIGHT_PANEL_TABS);
  });

  test('does not return repo unavailable reason by runtime', () => {
    expect(repoUnavailableReasonForRuntime('host')).toBeNull();
    expect(repoUnavailableReasonForRuntime('container')).toBeNull();
  });
});
