import { describe, expect, test } from 'bun:test';
import { FloatingWindowKeeper, fitFloatingBounds, isUsableFloatingBounds } from '../src/droneHub/app/floating-window-bounds';

const big = { width: 1600, height: 1000 };
const small = { width: 900, height: 600 };
const a = { x: 1200, y: 700, width: 360, height: 260 };
const b = { x: 800, y: 700, width: 360, height: 260 };

describe('floating window keeper', () => {
  test('windows clamped by a workspace resize snap back once the workspace grows again', () => {
    const keeper = new FloatingWindowKeeper();
    keeper.observe([{ id: 'a', measured: a }, { id: 'b', measured: b }], big);
    // Dockview clamps both into the smaller workspace; no user gesture happened.
    const clampedA = fitFloatingBounds(a, small);
    const clampedB = fitFloatingBounds(b, small);
    expect(clampedA).toEqual({ x: 540, y: 340, width: 360, height: 260 });
    expect(keeper.observe([{ id: 'a', measured: clampedA }, { id: 'b', measured: clampedB }], small)).toEqual([]);
    expect(keeper.targets([{ id: 'a', measured: clampedA }, { id: 'b', measured: clampedB }], small)).toEqual([]);
    // Growing back: both windows are away from where their intent lands.
    expect(keeper.targets([{ id: 'a', measured: clampedA }, { id: 'b', measured: clampedB }], big)).toEqual([
      { id: 'a', bounds: a },
      { id: 'b', bounds: b },
    ]);
  });

  test('a workspace narrower than a window shrinks it for now without forgetting its size', () => {
    const keeper = new FloatingWindowKeeper();
    keeper.observe([{ id: 'a', measured: a }], big);
    const tiny = { width: 300, height: 200 };
    expect(keeper.targets([{ id: 'a', measured: { x: 0, y: 0, width: 300, height: 200 } }], tiny)).toEqual([]);
    expect(keeper.targets([{ id: 'a', measured: { x: 0, y: 0, width: 300, height: 200 } }], big)).toEqual([{ id: 'a', bounds: a }]);
  });

  test('only the user moves a window: a drag updates intent, a clamp does not', () => {
    const keeper = new FloatingWindowKeeper();
    keeper.observe([{ id: 'a', measured: a }], big);
    const moved = { ...a, x: 100, y: 80 };
    // A layout change with no pointer gesture behind it is not a placement.
    expect(keeper.observe([{ id: 'a', measured: moved }], big)).toEqual([]);
    expect(keeper.intent('a')).toEqual(a);
    keeper.markGesture();
    expect(keeper.observe([{ id: 'a', measured: moved }], big)).toEqual(['a']);
    expect(keeper.intent('a')).toEqual(moved);
    // Clicking a clamped window without dragging it keeps the original intent.
    keeper.clearGesture();
    keeper.set('a', a);
    keeper.markGesture();
    expect(keeper.observe([{ id: 'a', measured: fitFloatingBounds(a, small) }], small)).toEqual([]);
    expect(keeper.intent('a')).toEqual(a);
  });

  test('windows that appear are adopted and windows that close are dropped', () => {
    const keeper = new FloatingWindowKeeper();
    expect(keeper.observe([{ id: 'a', measured: a }], big)).toEqual(['a']);
    expect(keeper.observe([{ id: 'b', measured: b }], big)).toEqual(['b']);
    expect(keeper.ids()).toEqual(['b']);
    expect(keeper.targets([{ id: 'a', measured: a }], big)).toEqual([]);
  });

  test('tolerates sub-pixel measurement noise', () => {
    const keeper = new FloatingWindowKeeper();
    keeper.observe([{ id: 'a', measured: a }], big);
    keeper.markGesture();
    const noisy = { x: a.x + 0.4, y: a.y - 0.6, width: a.width + 1, height: a.height };
    expect(keeper.observe([{ id: 'a', measured: noisy }], big)).toEqual([]);
    expect(keeper.targets([{ id: 'a', measured: noisy }], big)).toEqual([]);
  });

  test('never learns a frame measured before it had a size', () => {
    const keeper = new FloatingWindowKeeper();
    // A window that first appears as a 2px frame (workspace not laid out yet) is not adopted…
    expect(keeper.observe([{ id: 'a', measured: { x: 1911, y: 982, width: 2, height: 2 } }], big)).toEqual([]);
    expect(keeper.intent('a')).toBeUndefined();
    // …and once it has a real size, that is what sticks.
    expect(keeper.observe([{ id: 'a', measured: a }], big)).toEqual(['a']);
    // A later degenerate measurement, even during a gesture, does not overwrite it.
    keeper.markGesture();
    expect(keeper.observe([{ id: 'a', measured: { x: 0, y: 0, width: 0, height: 0 } }], big)).toEqual([]);
    expect(keeper.intent('a')).toEqual(a);
    // Explicit placement rejects it too.
    keeper.set('a', { x: 5, y: 5, width: 1, height: 1 });
    expect(keeper.intent('a')).toEqual(a);
    expect(isUsableFloatingBounds({ x: 0, y: 0, width: 39, height: 300 })).toBe(false);
    expect(isUsableFloatingBounds(a)).toBe(true);
  });
});
