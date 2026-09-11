import { describe, expect, test } from 'bun:test';
import {
  emptySlotDirectionForDrop,
  isCollapsedEmptySlot,
  isNoOpDropOverlay,
  isRedundantEdgeOverlay,
  type DropOverlayContext,
} from '../src/droneHub/app/workspace-drop-overlay';

const VIEW = 'workspace-1';

function context(overrides: Partial<DropOverlayContext>): DropOverlayContext {
  return {
    kind: 'content',
    position: 'bottom',
    viewId: VIEW,
    data: { viewId: VIEW, groupId: 'editor-group', panelId: 'tool:editor' },
    targetGroup: { id: 'editor-group', panelCount: 1 },
    ...overrides,
  };
}

describe('workspace drop overlays', () => {
  test('a lone panel dropped on an edge of its own pane leaves an empty slot on the other side', () => {
    expect(emptySlotDirectionForDrop(context({ position: 'bottom' }))).toBe('above');
    expect(emptySlotDirectionForDrop(context({ position: 'top' }))).toBe('below');
    expect(emptySlotDirectionForDrop(context({ position: 'left' }))).toBe('right');
    expect(emptySlotDirectionForDrop(context({ position: 'right' }))).toBe('left');
    // Those highlights stay visible because the workspace performs the drop.
    for (const position of ['top', 'bottom', 'left', 'right'] as const) {
      expect(isNoOpDropOverlay(context({ position }))).toBe(false);
    }
  });

  test('a whole group dropped on its own edge also leaves an empty slot', () => {
    const group = { viewId: VIEW, groupId: 'editor-group', panelId: null };
    expect(emptySlotDirectionForDrop(context({ data: group, targetGroup: { id: 'editor-group', panelCount: 3 }, position: 'right' }))).toBe('left');
    expect(isNoOpDropOverlay(context({ data: group, targetGroup: { id: 'editor-group', panelCount: 3 }, position: 'right' }))).toBe(false);
  });

  test('no empty slot for drops that Dockview already handles or that change nothing', () => {
    expect(emptySlotDirectionForDrop(context({ position: 'center' }))).toBeUndefined();
    expect(emptySlotDirectionForDrop(context({ targetGroup: { id: 'editor-group', panelCount: 2 }, position: 'bottom' }))).toBeUndefined();
    expect(emptySlotDirectionForDrop(context({ targetGroup: { id: 'chat-group', panelCount: 1 }, position: 'bottom' }))).toBeUndefined();
    expect(emptySlotDirectionForDrop(context({ kind: 'header_space', position: undefined }))).toBeUndefined();
    expect(emptySlotDirectionForDrop(context({ kind: 'edge', targetGroup: undefined, position: 'bottom' }))).toBeUndefined();
    expect(emptySlotDirectionForDrop(context({ data: undefined, position: 'bottom' }))).toBeUndefined();
  });

  test('still hides zones where a lone panel would stay exactly where it is', () => {
    expect(isNoOpDropOverlay(context({ position: 'center' }))).toBe(true);
    expect(isNoOpDropOverlay(context({ kind: 'header_space', position: undefined }))).toBe(true);
    expect(isNoOpDropOverlay(context({ kind: 'tab', position: undefined, targetPanelId: 'tool:editor' }))).toBe(true);
  });

  test('keeps edge zones of a pane that would still hold other panels', () => {
    const multi = { id: 'editor-group', panelCount: 2 };
    expect(isNoOpDropOverlay(context({ targetGroup: multi, position: 'bottom' }))).toBe(false);
    expect(isNoOpDropOverlay(context({ targetGroup: multi, position: 'center' }))).toBe(true);
    expect(isNoOpDropOverlay(context({ targetGroup: multi, kind: 'tab', position: undefined, targetPanelId: 'tool:editor' }))).toBe(true);
    expect(isNoOpDropOverlay(context({ targetGroup: multi, kind: 'tab', position: undefined, targetPanelId: 'tool:terminal' }))).toBe(false);
  });

  test('keeps zones on other panes and leaves foreign drags to Dockview', () => {
    expect(isNoOpDropOverlay(context({ targetGroup: { id: 'chat-group', panelCount: 1 } }))).toBe(false);
    expect(isNoOpDropOverlay(context({ data: undefined }))).toBe(false);
    expect(isNoOpDropOverlay(context({ data: { viewId: 'other', groupId: 'editor-group', panelId: 'tool:editor' } }))).toBe(false);
  });

  test('hides a whole group dropped onto its own centre but not a tab group split', () => {
    const group = { viewId: VIEW, groupId: 'editor-group', panelId: null };
    expect(isNoOpDropOverlay(context({ data: group, position: 'center', targetGroup: { id: 'editor-group', panelCount: 3 } }))).toBe(true);
    expect(isNoOpDropOverlay(context({ data: group, kind: 'header_space', position: undefined, targetGroup: { id: 'editor-group', panelCount: 3 } }))).toBe(true);
    expect(isNoOpDropOverlay(context({ data: { ...group, tabGroupId: 'tg' }, targetGroup: { id: 'editor-group', panelCount: 3 } }))).toBe(false);
  });

  test('hides a workspace-edge highlight when a full-height pane already offers that drop', () => {
    const workspace = { left: 0, top: 0, right: 1800, bottom: 900 };
    const columns = [
      { left: 0, top: 0, right: 600, bottom: 900 },
      { left: 604, top: 0, right: 1200, bottom: 900 },
      { left: 1204, top: 0, right: 1800, bottom: 900 },
    ];
    expect(isRedundantEdgeOverlay('right', workspace, columns)).toBe(true);
    expect(isRedundantEdgeOverlay('left', workspace, columns)).toBe(true);
    // No single column spans the full width, so a full-width row is a new layout.
    expect(isRedundantEdgeOverlay('bottom', workspace, columns)).toBe(false);
    expect(isRedundantEdgeOverlay('top', workspace, columns)).toBe(false);

    const stackedRight = [
      { left: 0, top: 0, right: 900, bottom: 900 },
      { left: 904, top: 0, right: 1800, bottom: 448 },
      { left: 904, top: 452, right: 1800, bottom: 900 },
    ];
    expect(isRedundantEdgeOverlay('right', workspace, stackedRight)).toBe(false);
    expect(isRedundantEdgeOverlay('left', workspace, stackedRight)).toBe(true);
    expect(isRedundantEdgeOverlay('center', workspace, stackedRight)).toBe(false);

    expect(isNoOpDropOverlay(context({
      kind: 'edge', position: 'right', targetGroup: undefined, workspaceRect: workspace, gridGroupRects: columns,
    }))).toBe(true);
  });

  test('an empty slot dragged shut collapses, but never while the workspace has no size', () => {
    const workspace = { width: 1800, height: 900 };
    expect(isCollapsedEmptySlot({ width: 0, height: 450 }, workspace)).toBe(true);
    expect(isCollapsedEmptySlot({ width: 600, height: 10 }, workspace)).toBe(true);
    expect(isCollapsedEmptySlot({ width: 600, height: 450 }, workspace)).toBe(false);
    expect(isCollapsedEmptySlot({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(false);
  });
});
