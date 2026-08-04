import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DroneWorkspaceHeaderFrame } from '../src/droneHub/app/DroneWorkspaceHeaderFrame';
import { WorkspaceToolIcon } from '../src/droneHub/app/WorkspaceToolIcon';
import { RIGHT_PANEL_TABS, rightPanelHeaderTabs } from '../src/droneHub/app/app-config';

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

  test('shows workspace panel shortcuts as an icon activity bar', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/SelectedDroneWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('<span>Tools</span>');
    expect(source).toContain('aria-label="Workspace tools"');
    expect(source).toContain("align={index === tabs.length - 1 ? 'end' : 'center'}");
    expect(source).toContain('contextMenuPanelBaseClass');
    expect(source).toContain('contextMenuItemBaseClass as dropdownMenuItemBaseClass');
    expect(source).toContain('<WorkspaceToolIcon tab={tab} className="h-[17px] w-[17px]" />');
    expect(source).toContain('rightPanelHeaderTabs(rightPanelTabs).map((tab, index, tabs) =>');
    expect(source).toContain("aria-current={active ? 'page' : undefined}");
    expect(source).toContain("data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}");
  });

  test('uses a complete, optically consistent workspace icon set', () => {
    for (const tab of rightPanelHeaderTabs(RIGHT_PANEL_TABS)) {
      const html = renderToStaticMarkup(<WorkspaceToolIcon tab={tab} />);
      expect(html).toContain(`data-workspace-tool-icon="${tab}"`);
      expect(html).toContain('stroke-width="1.75"');
      expect(html).toContain('width="17"');
    }
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
