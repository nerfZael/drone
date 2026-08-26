import { describe, expect, mock, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { paneModuleTimeoutMessage } from '../src/droneHub/app/AsyncPaneBoundary';
import {
  isRightPanelTabLazyLoaded,
  RIGHT_PANEL_TABS,
} from '../src/droneHub/app/app-config';

mock.module('../src/droneHub/whiteboard/WhiteboardDock', () => ({
  WhiteboardDock: () => null,
}));

const { RightPanelPaneLoadingFallback } = await import(
  '../src/droneHub/app/RightPanelTabContent'
);

describe('right panel tab content', () => {
  test('tracks every right panel feature pane as lazy-loaded', () => {
    for (const tab of RIGHT_PANEL_TABS) {
      expect(isRightPanelTabLazyLoaded(tab)).toBe(true);
    }
  });

  test('renders a pane-shaped loading fallback', () => {
    const html = renderToStaticMarkup(React.createElement(RightPanelPaneLoadingFallback, { tab: 'editor' }));
    expect(html).toContain('Loading editor…');
    expect(html).toContain('bg-[var(--panel-alt)]');
    expect(html).toContain('animate-spin');
    expect(html).toContain('role="status"');
  });

  test('uses the standard pane timeout message', () => {
    expect(paneModuleTimeoutMessage('Whiteboard')).toBe(
      'Whiteboard panel module is still loading. Retry after the current frontend finishes updating.',
    );
  });

  test('keeps non-critical panes behind module loaders', () => {
    const sourcePath = path.join(import.meta.dir, '../src/droneHub/app/RightPanelTabContent.tsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    expect(source).not.toContain('React.lazy');
    expect(source).toContain("import('../pullRequests/DronePullRequestsDock')");
    expect(source).not.toContain("from '../files/OpenedDroneFilePanel'");
    expect(source).not.toContain("from '../files/QuickOpenModal'");
    expect(source).toContain("import('../whiteboard/WhiteboardDock')");
    expect(source).toContain("import('./DroneEditorDock')");
    expect(source).toContain('loadWhiteboardDock');
    expect(source).toContain('loadDroneEditorDock');
    for (const tab of RIGHT_PANEL_TABS) {
      if (tab === 'assistant') {
        expect(source).toContain("if (tab === 'assistant')");
      } else {
        expect(source).toContain(`case '${tab}'`);
      }
    }
    expect(source.match(/<PaneModule tab=\{tab\}/g)?.length).toBe(RIGHT_PANEL_TABS.length);
  });

  test('loads the changes dock only when inspecting a pull request', () => {
    const sourcePath = path.join(import.meta.dir, '../src/droneHub/pullRequests/DronePullRequestsDock.tsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    expect(source).not.toContain("from '../changes'");
    expect(source).toContain("import('../changes/DroneChangesDock')");
    expect(source).toContain('fixedContextMode="pull-request"');
  });
});
