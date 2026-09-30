import { describe, expect, test } from 'bun:test';
import {
  EXPANSION_MAX_CODE_COLUMNS,
  EXPANSION_NEIGHBOUR_STRIP_PX,
  expansionKeyForPanel,
  planPanelExpansion,
  targetCodeColumns,
  visualLineLength,
} from '../src/droneHub/app/workspace-panel-expansion';

const workspace = { left: 0, top: 0, width: 1600, height: 1000 };

describe('planPanelExpansion', () => {
  test('a thin row under the canvas grows upward to 40% of the height, keeping its bottom edge', () => {
    const plan = planPanelExpansion({ slot: { left: 800, top: 940, width: 600, height: 60 }, workspace, extraWidth: null });
    expect(plan).toEqual({ axis: 'y', rect: { left: 800, top: 600, width: 600, height: 400 } });
  });

  test('a thin column on the right grows left, keeping its right edge', () => {
    const plan = planPanelExpansion({ slot: { left: 1550, top: 0, width: 50, height: 1000 }, workspace, extraWidth: null });
    expect(plan).toEqual({ axis: 'x', rect: { left: 960, top: 0, width: 640, height: 1000 } });
  });

  test('measured content only widens, toward the side with more room', () => {
    const plan = planPanelExpansion({ slot: { left: 0, top: 0, width: 500, height: 1000 }, workspace, extraWidth: 220 });
    expect(plan).toEqual({ axis: 'x', rect: { left: 0, top: 0, width: 720, height: 1000 } });
  });

  test('never covers the whole workspace', () => {
    const plan = planPanelExpansion({ slot: { left: 0, top: 0, width: 500, height: 1000 }, workspace, extraWidth: 5000 });
    expect(plan?.rect.width).toBe(workspace.width - EXPANSION_NEIGHBOUR_STRIP_PX);
  });

  test('stays inside the workspace when growing from the middle', () => {
    const plan = planPanelExpansion({ slot: { left: 900, top: 0, width: 400, height: 500 }, workspace, extraWidth: 600 });
    expect(plan!.rect.left + plan!.rect.width).toBeLessThanOrEqual(workspace.width);
    expect(plan!.rect.width).toBe(1000);
  });

  test('does nothing when the content fits or the window is already large', () => {
    expect(planPanelExpansion({ slot: { left: 0, top: 0, width: 500, height: 1000 }, workspace, extraWidth: 0 })).toBeNull();
    expect(planPanelExpansion({ slot: { left: 0, top: 0, width: 900, height: 1000 }, workspace, extraWidth: null })).toBeNull();
  });
});

describe('content-fit width', () => {
  test('ignores the longest 5% of lines and blank lines', () => {
    const lengths = [...Array(95).fill(80), ...Array(5).fill(3000), ...Array(50).fill(0)];
    expect(targetCodeColumns(lengths)).toBe(80);
  });

  test('caps the width even when most lines are long', () => {
    expect(targetCodeColumns(Array(20).fill(400))).toBe(EXPANSION_MAX_CODE_COLUMNS);
  });

  test('expands tabs and ignores trailing whitespace', () => {
    expect(visualLineLength('\tab  ', 4)).toBe(6);
    expect(visualLineLength('a\tb', 4)).toBe(5);
  });
});

test('file and side chat windows share one setting per kind', () => {
  expect(expansionKeyForPanel('file-tab:abc')).toBe('file');
  expect(expansionKeyForPanel('side-chat:plan')).toBe('side-chat');
  expect(expansionKeyForPanel('tool:terminal')).toBe('tool:terminal');
});
