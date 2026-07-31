import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DroneWorkspaceHeaderFrame } from '../src/droneHub/app/DroneWorkspaceHeaderFrame';

describe('DroneWorkspaceHeaderFrame', () => {
  test('keeps the compact header at its tighter fixed single-row height', () => {
    const html = renderToStaticMarkup(
      <DroneWorkspaceHeaderFrame selectedHeader>
        <div>Header</div>
      </DroneWorkspaceHeaderFrame>,
    );

    expect(html).toContain('h-11');
    expect(html).not.toContain('overflow-y-auto');
  });

  test('gives the selected drone title a subtle size lift', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/SelectedDroneWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('dh-type-workspace-title !text-[.875rem]');
  });

  test('groups workspace panel shortcuts into one tools menu', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/SelectedDroneWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<span>Tools</span>');
    expect(source).toContain('aria-expanded={workspaceToolsMenuOpen}');
    expect(source).toContain('contextMenuPanelBaseClass');
    expect(source).toContain('contextMenuItemBaseClass as dropdownMenuItemBaseClass');
    expect(source).toContain('<WorkspaceToolIcon tab={tab} />');
    expect(source).toContain('rightPanelHeaderTabs(rightPanelTabs).map((tab) =>');
    expect(source).toContain("data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}");
  });

  test('uses context-menu icon slots for sync and action commands', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/SelectedDroneWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<HeaderMenuItemIcon><IconRefresh');
    expect(source).toContain('<HeaderMenuItemIcon><IconTerminal');
    expect(source).toContain('<HeaderMenuItemIcon><IconCopy');
    expect(source).toContain('<HeaderMenuItemIcon><IconVsCode');
  });
});
