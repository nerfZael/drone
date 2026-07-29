import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const productionSurfaces = [
  {
    name: 'Sidebar',
    path: '../src/droneHub/app/DroneSidebar.tsx',
    components: ['UiActionMenu', 'UiPanelToolbar', 'UiToolbarIconButton'],
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
    components: ['UiPaneState', 'UiPanel', 'UiPanelToolbar', 'UiToolbarButton'],
  },
  {
    name: 'Workflows',
    path: '../src/droneHub/workflows/DroneWorkflowsDock.tsx',
    components: ['UiNavigationRow', 'UiPanelHeader', 'UiPanelStatusStrip', 'UiStatusDot'],
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
});
