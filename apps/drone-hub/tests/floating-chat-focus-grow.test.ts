import { describe, expect, test } from 'bun:test';
import { collapseUnderPointer, planGrownBounds } from '../src/droneHub/app/floating-chat-focus-grow';
import { FloatingWindowKeeper } from '../src/droneHub/app/floating-window-bounds';

const workspace = { width: 2000, height: 1200 };
const corner = { x: 1660, y: 880, width: 320, height: 300 };

describe('focus grow planning', () => {
  test('grows a corner window toward the centre until prose fits and the last agent block is visible', () => {
    const grown = planGrownBounds({ current: corner, workspace, needs: { width: 700, height: 560 } });
    expect(grown).toEqual({ x: 1280, y: 620, width: 700, height: 560 });
  });

  test('never shrinks, and caps growth at a share of the workspace unless the window is already larger', () => {
    expect(planGrownBounds({ current: corner, workspace, needs: { width: 200, height: 100 } })).toBeNull();
    const capped = planGrownBounds({ current: corner, workspace, needs: { width: 5000, height: 5000 } })!;
    expect(capped.width).toBe(1100);
    expect(capped.height).toBe(840);
    expect(capped.x + capped.width).toBeLessThanOrEqual(workspace.width);
    expect(capped.y + capped.height).toBeLessThanOrEqual(workspace.height);
    const huge = { x: 0, y: 0, width: 1500, height: 1000 };
    expect(planGrownBounds({ current: huge, workspace, needs: { width: 700, height: 560 } })).toBeNull();
  });

  test('a window on the left or top grows right and down and stays inside the workspace', () => {
    const grown = planGrownBounds({ current: { x: 20, y: 20, width: 320, height: 300 }, workspace, needs: { width: 700, height: 560 } })!;
    expect([grown.x, grown.y]).toEqual([20, 20]);
    const tight = planGrownBounds({ current: { x: 1900, y: 1150, width: 80, height: 40 }, workspace, needs: { width: 700, height: 560 } })!;
    expect(tight.x + tight.width).toBeLessThanOrEqual(workspace.width);
    expect(tight.y + tight.height).toBeLessThanOrEqual(workspace.height);
  });

  test('collapsing under the pointer keeps the pointer at the same spot on the title bar', () => {
    const grown = { x: 1000, y: 500, width: 800, height: 600 };
    const collapsed = collapseUnderPointer({ grown, small: { width: 320, height: 300 }, pointer: { x: 1400, y: 510 } });
    expect(collapsed).toEqual({ x: 1240, y: 500, width: 320, height: 300 });
    expect((1400 - collapsed.x) / collapsed.width).toBeCloseTo((1400 - grown.x) / grown.width, 5);
  });
});

describe('keeper holds', () => {
  const big = { width: 1600, height: 1000 };
  const small = { x: 1200, y: 700, width: 360, height: 260 };
  const grown = { x: 900, y: 400, width: 660, height: 560 };

  test('a held window is neither learned nor snapped back, until the user changes it', () => {
    const keeper = new FloatingWindowKeeper();
    keeper.observe([{ id: 'a', measured: small }], big);
    keeper.hold('a', grown);
    // The click that focused the window was a gesture; the grow that followed is not a placement.
    keeper.markGesture();
    expect(keeper.observe([{ id: 'a', measured: grown }], big)).toEqual([]);
    expect(keeper.intent('a')).toEqual(small);
    expect(keeper.targets([{ id: 'a', measured: grown }], big)).toEqual([]);
    // Resizing while grown is a placement and ends the hold.
    const resized = { ...grown, width: 720 };
    expect(keeper.observe([{ id: 'a', measured: resized }], big)).toEqual(['a']);
    expect(keeper.intent('a')).toEqual(resized);
    expect(keeper.held('a')).toBeUndefined();
  });

  test('releasing a hold lets the intent apply again', () => {
    const keeper = new FloatingWindowKeeper();
    keeper.observe([{ id: 'a', measured: small }], big);
    keeper.hold('a', grown);
    keeper.release('a');
    expect(keeper.targets([{ id: 'a', measured: grown }], big)).toEqual([{ id: 'a', bounds: small }]);
  });
});
