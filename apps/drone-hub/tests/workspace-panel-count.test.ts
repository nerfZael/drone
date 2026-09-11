import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { workspaceGridPanelCount } from '../src/droneHub/app/workspace-panel-count';

const group = (type: string, panels: number) => ({ api: { location: { type } }, panels: Array(panels).fill(null) });

describe('workspace panel count', () => {
  test('counts docked panels only, so floating side chats leave the lone main chat alone', () => {
    expect(workspaceGridPanelCount([group('grid', 1)])).toBe(1);
    expect(workspaceGridPanelCount([group('grid', 1), group('floating', 1), group('floating', 1)])).toBe(1);
    expect(workspaceGridPanelCount([group('grid', 1), group('grid', 2), group('popout', 1)])).toBe(3);
    expect(workspaceGridPanelCount([])).toBe(0);
  });

  test('an empty slot occupies the grid, so the lone chat keeps its tab bar next to it', () => {
    expect(workspaceGridPanelCount([group('grid', 1), group('grid', 0)])).toBe(2);
    expect(workspaceGridPanelCount([group('grid', 0), group('floating', 1)])).toBe(1);
  });

  test('the single-panel tab bar rule is scoped to the docked grid', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('.dh-dockable-workspace--single-panel .dv-grid-view .dv-tabs-and-actions-container');
    expect(styles).not.toMatch(/--single-panel \.dv-tabs-and-actions-container/);
  });

  test('forking or deleting a side chat shows no in-flow progress banner', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/use-workspace-side-chats.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('Opening side chat at');
    expect(source).not.toContain('Deleting side chat…');
    expect(source).not.toContain('Keeping chat in the sidebar…');
    // Outcomes the user must see still surface through the status banner.
    expect(source).toContain("'Chat kept in the sidebar.'");
    expect(source).toContain('No completed assistant answer available yet');
  });
});
