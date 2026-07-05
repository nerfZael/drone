import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RIGHT_PANEL_TABS } from '../src/droneHub/app/app-config';
import {
  LAZY_RIGHT_PANEL_TABS,
  RightPanelPaneLoadingFallback,
  isRightPanelTabLazyLoaded,
} from '../src/droneHub/app/RightPanelTabContent';

describe('right panel tab content', () => {
  test('lazy-loads every right panel pane', () => {
    expect([...LAZY_RIGHT_PANEL_TABS].sort()).toEqual(RIGHT_PANEL_TABS.filter((tab) => tab !== 'files').sort());
    expect(isRightPanelTabLazyLoaded('files')).toBe(false);
    for (const tab of RIGHT_PANEL_TABS) {
      if (tab !== 'files') expect(isRightPanelTabLazyLoaded(tab)).toBe(true);
    }
  });

  test('renders a pane-shaped loading fallback', () => {
    const html = renderToStaticMarkup(React.createElement(RightPanelPaneLoadingFallback, { tab: 'files' }));
    expect(html).toContain('Loading files...');
    expect(html).toContain('bg-[var(--panel-alt)]');
    expect(html).toContain('border-[var(--border-subtle)]');
  });
});
