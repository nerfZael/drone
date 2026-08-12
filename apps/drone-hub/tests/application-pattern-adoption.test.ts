import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const productionSurfaces = [
  {
    name: 'Sidebar',
    path: '../src/droneHub/app/DroneSidebar.tsx',
    components: ['UiActionMenu', 'UiNavigationRow', 'UiPanelToolbar', 'UiToolbarIconButton'],
  },
  {
    name: 'Dockable workspace chrome',
    path: '../src/droneHub/app/DockableDroneWorkspace.tsx',
    components: ['UiPaneState', 'UiPanel', 'UiPanelToolbar', 'UiToolbarSegmentedControl'],
  },
  {
    name: 'Changes',
    path: '../src/droneHub/changes/DroneChangesDock.tsx',
    components: [
      'UiActionMenu',
      'UiPaneState',
      'UiPanel',
      'UiResizeHandle',
      'UiToolbarSegmentedControl',
    ],
  },
  {
    name: 'Browser',
    path: '../src/droneHub/overview/DronePreviewDock.tsx',
    components: ['UiPaneState', 'UiPanelHeader', 'UiPanelToolbar', 'UiToolbarInput'],
  },
  {
    name: 'Canvas',
    path: '../src/droneHub/canvas/DroneCanvasDock.tsx',
    components: ['UiMenuSelect', 'UiPaneState', 'UiPanel', 'UiPanelToolbar', 'UiToolbarButton'],
  },
  {
    name: 'Workflows',
    path: '../src/droneHub/workflows/DroneWorkflowsDock.tsx',
    components: ['UiDialog', 'UiPanelHeader', 'UiPanelStatusStrip', 'UiStatusDot', 'UiTextarea'],
  },
  {
    name: 'Environment',
    path: '../src/droneHub/env/DroneEnvDock.tsx',
    components: ['UiCheckbox', 'UiPaneState', 'UiPanel', 'UiPanelHeader', 'UiPanelStatusStrip'],
  },
  {
    name: 'Files',
    path: '../src/droneHub/files/DroneFilesDock.tsx',
    components: ['UiPaneState', 'UiPanel', 'UiPanelStatusStrip'],
  },
  {
    name: 'Links',
    path: '../src/droneHub/overview/DroneLinksDock.tsx',
    components: ['UiPaneState', 'UiPanel', 'UiPanelHeader', 'UiStatusDot'],
  },
  {
    name: 'Pull requests',
    path: '../src/droneHub/pullRequests/DronePullRequestsDock.tsx',
    components: ['UiCenteredLoadingState', 'UiPaneState', 'UiPanel', 'UiPanelStatusStrip'],
  },
  {
    name: 'Change requests',
    path: '../src/droneHub/changeRequests/DroneChangeRequestsDock.tsx',
    components: ['UiButton', 'UiCenteredLoadingState', 'UiPaneState', 'UiPanel', 'UiPanelStatusStrip'],
  },
  {
    name: 'Terminal',
    path: '../src/droneHub/terminal/DroneTerminalDock.tsx',
    components: ['UiPaneState', 'UiPanel', 'UiPanelBody', 'UiPanelStatusStrip'],
  },
  {
    name: 'Whiteboard',
    path: '../src/droneHub/whiteboard/WhiteboardDock.tsx',
    components: ['UiMenuSelect', 'UiPaneState', 'UiPanel', 'UiPanelHeader', 'UiPanelToolbar'],
  },
] as const;

describe('application pattern adoption', () => {
  for (const surface of productionSurfaces) {
    test(`${surface.name} composes the shared component library`, () => {
      const source = readFileSync(new URL(surface.path, import.meta.url), 'utf8');

      expect(source).toContain("from '../../ui/components'");
      for (const component of surface.components) {
        expect(source).toContain(`<${component}`);
      }
    });
  }

  test('keeps the menu select inside the shared component library', () => {
    const sharedMenuSelect = new URL('../src/ui/components/MenuSelect.tsx', import.meta.url);
    const legacyMenuSelect = new URL('../src/ui/menuSelect.tsx', import.meta.url);

    expect(existsSync(sharedMenuSelect)).toBe(true);
    expect(existsSync(legacyMenuSelect)).toBe(false);
  });
});
