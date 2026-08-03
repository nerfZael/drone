import { describe, expect, test } from 'bun:test';
import {
  RIGHT_PANEL_TAB_LABELS,
  RIGHT_PANEL_TABS,
  parseRightPanelTab,
  repoUnavailableReasonForRuntime,
  rightPanelHeaderTabs,
  rightPanelTabsForRuntime,
} from '../src/droneHub/app/app-config';

describe('host runtime repo UX safeguards', () => {
  test('keeps full right panel tabs for host runtime', () => {
    const tabs = rightPanelTabsForRuntime('host');
    expect(tabs).toContain('changes');
    expect(tabs).toContain('prs');
    expect(tabs).toContain('terminal');
    expect(tabs).toContain('env');
    expect(tabs).toContain('editor');
    expect(tabs).not.toContain('files');
    expect(tabs).toEqual(RIGHT_PANEL_TABS);
  });

  test('keeps full right panel tabs for container runtime', () => {
    expect(rightPanelTabsForRuntime('container')).toEqual(RIGHT_PANEL_TABS);
    expect(rightPanelTabsForRuntime('')).toEqual(RIGHT_PANEL_TABS);
  });

  test('keeps deep-link panes internal while simplifying the workspace header', () => {
    const headerTabs = rightPanelHeaderTabs(RIGHT_PANEL_TABS);

    expect(headerTabs).toContain('editor');
    expect(headerTabs).not.toContain('files');
    expect(headerTabs).not.toContain('links');
    expect(RIGHT_PANEL_TABS).toContain('editor');
    expect(RIGHT_PANEL_TABS).toContain('links');
    expect(RIGHT_PANEL_TAB_LABELS.env).toBe('Env');
  });

  test('migrates the legacy Files tab to Editor', () => {
    expect(parseRightPanelTab('files', 'terminal')).toBe('editor');
  });

  test('does not return repo unavailable reason by runtime', () => {
    expect(repoUnavailableReasonForRuntime('host')).toBeNull();
    expect(repoUnavailableReasonForRuntime('container')).toBeNull();
  });
});
