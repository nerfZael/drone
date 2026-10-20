import { describe, expect, test } from 'bun:test';
import {
  layoutOrganizedBoard,
  ORGANIZED_COLUMN_GAP_PX,
  organizedCardsWith,
  organizedDropAt,
  organizedDropLine,
  organizedDropSlot,
  sideChatSquaresWidthPx,
  type OrganizedCard,
} from '../src/droneHub/canvas/organized-board-layout';

const card = (nodeId: string, parentNodeId: string | null = null, width = 100): OrganizedCard => ({ nodeId, width, parentNodeId });
const options = { cardHeight: 30, rowGap: 12, viewportWidth: 1200, viewportHeight: 800 };

describe('organized board layout', () => {
  test('children go right of their parent, the first on its row and the next ones below', () => {
    const layout = layoutOrganizedBoard([
      card('plan', null, 120),
      card('copy', 'plan'),
      card('worker', 'plan'),
      card('copy of copy', 'copy'),
      card('notes'),
    ], options);
    const { positions } = layout;
    expect(positions.copy).toEqual({ x: 120 + ORGANIZED_COLUMN_GAP_PX, y: positions.plan!.y });
    expect(positions['copy of copy']!.y).toBe(positions.copy!.y);
    expect(positions['copy of copy']!.x).toBe(positions.copy!.x + 100 + ORGANIZED_COLUMN_GAP_PX);
    // The worker starts below the copy's whole subtree.
    expect(positions.worker).toEqual({ x: positions.copy!.x, y: positions.plan!.y + 42 });
    // The next tree goes below the first one, with a little more room between them.
    expect(positions.notes!.x).toBe(positions.plan!.x);
    expect(positions.notes!.y).toBe(positions.worker!.y + 30 + 12 + 10);
    // Small boards are never zoomed in past 1:1.
    expect(layout.view.scale).toBe(1);
  });

  test('parents off the board and loops leave a card as a root', () => {
    const { positions } = layoutOrganizedBoard([card('a', 'b'), card('b', 'a'), card('c', 'gone')], options);
    expect(positions.a!.x).toBe(positions.b!.x);
    expect(positions.c!.x).toBe(positions.a!.x);
  });

  test('a card below a loop still hangs from its parent', () => {
    const { positions } = layoutOrganizedBoard([card('a', 'b'), card('b', 'c'), card('c', 'b')], options);
    expect(positions.b!.x).toBe(positions.c!.x);
    expect(positions.a!.x).toBeGreaterThan(positions.b!.x);
    expect(positions.a!.y).toBe(positions.b!.y);
  });

  test('many trees spread into columns to fit the pane at the largest zoom', () => {
    const cards = Array.from({ length: 30 }, (_, index) => card(`chat ${index}`, null, 160));
    const layout = layoutOrganizedBoard(cards, options);
    const columns = new Set(Object.values(layout.positions).map((position) => position.x));
    expect(columns.size).toBeGreaterThan(1);
    expect(layout.width * layout.view.scale).toBeLessThanOrEqual(1200);
    expect(layout.height * layout.view.scale).toBeLessThanOrEqual(800);
    // In order: down each column, then across.
    expect(layout.positions['chat 1']!.y).toBeGreaterThan(layout.positions['chat 0']!.y);
    expect(layout.positions['chat 29']!.x).toBeGreaterThan(layout.positions['chat 0']!.x);
  });

  test('a wide tree among many small ones still gets the column count that fits', () => {
    // An even share of the height spills these trees into three columns; two fit at a readable zoom.
    const cards = Array.from({ length: 34 }, (_, index) => card(`chat ${index}`, null, 150));
    cards.push(card('reviewer', null, 166), card('fork', 'reviewer', 128), card('fork of fork', 'fork', 114));
    for (const worker of ['lava', 'mech', 'menus']) cards.push(card(worker, 'reviewer', 204));
    const layout = layoutOrganizedBoard(cards, { ...options, viewportWidth: 847, viewportHeight: 838 });
    expect(layout.view.scale).toBeGreaterThan(0.75);
    expect(layout.height * layout.view.scale).toBeLessThanOrEqual(838);
  });

  test('a board too big to read at full size still fits, smaller', () => {
    const cards = Array.from({ length: 400 }, (_, index) => card(`chat ${index}`, null, 300));
    const layout = layoutOrganizedBoard(cards, { ...options, viewportWidth: 900, viewportHeight: 500 });
    expect(layout.view.scale).toBeLessThan(0.7);
    expect(layout.width * layout.view.scale).toBeLessThanOrEqual(900);
    expect(layout.height * layout.view.scale).toBeLessThanOrEqual(500);
  });

  test('room kept free at the bottom shrinks the fit and moves the board up', () => {
    const cards = Array.from({ length: 16 }, (_, index) => card(`chat ${index}`, null, 160));
    const free = layoutOrganizedBoard(cards, { ...options, viewportHeight: 700 });
    const inset = layoutOrganizedBoard(cards, { ...options, viewportHeight: 700, bottomInset: 60 });
    expect(inset.height * inset.view.scale + inset.view.panY).toBeLessThanOrEqual(700 - 60);
    expect(inset.view.panY).toBeLessThanOrEqual(free.view.panY);
  });

  test('an empty board has nothing to place', () => {
    expect(layoutOrganizedBoard([], options).positions).toEqual({});
  });
});

describe('moving cards on the organized board', () => {
  // plan ─ copy ─ copy of copy
  //      └ worker
  // notes
  // review
  const layout = layoutOrganizedBoard([
    card('plan', null, 120), card('copy', 'plan'), card('worker', 'plan'), card('copy of copy', 'copy'), card('notes'), card('review'),
  ], options);
  const { positions, subtreeRects } = layout;
  const inside = (id: string, part: 'top' | 'bottom') => {
    const rect = subtreeRects[id]!;
    return { x: rect.x + 4, y: part === 'top' ? rect.y + 2 : rect.y + rect.height - 2 };
  };

  test('each card knows its subtree and its parent', () => {
    expect(layout.parentOf).toMatchObject({ plan: null, copy: 'plan', worker: 'plan', 'copy of copy': 'copy', notes: null });
    // plan's tree: three cards across, two rows down.
    expect(subtreeRects.plan).toMatchObject({ x: positions.plan!.x, y: positions.plan!.y, height: 42 + 30 });
    expect(subtreeRects.copy!.width).toBe(100 + ORGANIZED_COLUMN_GAP_PX + 100);
    expect(subtreeRects.worker).toEqual({ ...positions.worker!, width: 100, height: 30 });
  });

  test('a tree goes before or after another tree, and a child before or after its siblings', () => {
    expect(organizedDropSlot(layout, 'review', inside('plan', 'top'))).toEqual({ targetId: 'plan', placement: 'before' });
    expect(organizedDropSlot(layout, 'plan', inside('notes', 'bottom'))).toEqual({ targetId: 'notes', placement: 'after' });
    expect(organizedDropSlot(layout, 'worker', inside('copy', 'top'))).toEqual({ targetId: 'copy', placement: 'before' });
    // The gap between two trees belongs to them too.
    const between = { x: subtreeRects.notes!.x + 4, y: subtreeRects.notes!.y - 4 };
    expect(organizedDropSlot(layout, 'review', between)).toEqual({ targetId: 'notes', placement: 'before' });
  });

  test('no slot where the card already is, beside a card with another parent, or over nothing', () => {
    expect(organizedDropSlot(layout, 'notes', inside('plan', 'bottom'))).toBeNull();
    expect(organizedDropSlot(layout, 'notes', inside('review', 'top'))).toBeNull();
    expect(organizedDropSlot(layout, 'worker', inside('notes', 'top'))).toBeNull();
    expect(organizedDropSlot(layout, 'notes', inside('worker', 'top'))).toBeNull();
    expect(organizedDropSlot(layout, 'notes', { x: -50, y: -50 })).toBeNull();
    expect(organizedDropSlot(layout, 'gone', inside('plan', 'top'))).toBeNull();
  });

  test('the middle of a card folds into it; its top edge, or the bottom of a card with nothing beside it, reorders', () => {
    const card = (id: string, at: number) => ({ x: layout.cardRects[id]!.x + 4, y: layout.cardRects[id]!.y + layout.cardRects[id]!.height * at });
    expect(organizedDropAt(layout, ['review'], card('notes', 0.5))).toEqual({ kind: 'fold', targetId: 'notes' });
    expect(organizedDropAt(layout, ['review'], card('notes', 0.1))).toEqual({ kind: 'slot', slot: { targetId: 'notes', placement: 'before' } });
    // review already follows notes: its bottom edge is where review is, so nothing happens.
    expect(organizedDropAt(layout, ['review'], card('notes', 0.9))).toBeNull();
    // plan has cards beside it: below it is not "after plan's tree", so its bottom edge folds.
    expect(organizedDropAt(layout, ['review'], card('plan', 0.9))).toEqual({ kind: 'fold', targetId: 'plan' });
    // Folded with a card's own children is impossible: they go with it.
    expect(organizedDropAt(layout, ['plan'], card('copy', 0.5))).toBeNull();
    // A child onto another tree's card folds: it never reorders there.
    expect(organizedDropAt(layout, ['worker'], card('notes', 0.1))).toEqual({ kind: 'fold', targetId: 'notes' });
    // Several cards only fold.
    expect(organizedDropAt(layout, ['notes', 'review'], card('plan', 0.1))).toEqual({ kind: 'fold', targetId: 'plan' });
    expect([...organizedCardsWith(layout, ['plan'])].sort()).toEqual(['copy', 'copy of copy', 'plan', 'worker']);
  });

  test('the line sits in the middle of the gap on the slot\'s side', () => {
    const above = organizedDropLine(layout, { targetId: 'notes', placement: 'before' })!;
    expect(above.y).toBe(subtreeRects.notes!.y - (12 + 10) / 2);
    const below = organizedDropLine(layout, { targetId: 'copy', placement: 'after' })!;
    expect(below.y).toBe(subtreeRects.copy!.y + 30 + 12 / 2);
    expect(below.x).toBe(subtreeRects.copy!.x);
  });
});

describe('side chat squares', () => {
  test('squares widen the card, up to a few and then a count', () => {
    expect(sideChatSquaresWidthPx(0)).toBe(0);
    expect(sideChatSquaresWidthPx(2)).toBe(8 + 20 + 3);
    expect(sideChatSquaresWidthPx(12)).toBe(sideChatSquaresWidthPx(8) + 24);
  });
});
