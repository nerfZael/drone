import { describe, expect, test } from 'bun:test';
import {
  layoutOrganizedBoard,
  ORGANIZED_COLUMN_GAP_PX,
  sideChatSquaresByChat,
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

describe('side chat squares', () => {
  test('a side chat of a side chat goes on the card of the chat they started from, oldest first', () => {
    const squares = sideChatSquaresByChat([
      { name: 'later', sourceChatName: 'plan', createdAt: '2026-10-02T00:00:00Z' },
      { name: 'first', sourceChatName: 'plan', createdAt: '2026-10-01T00:00:00Z' },
      { name: 'nested', sourceChatName: 'first', createdAt: '2026-10-03T00:00:00Z' },
      { name: 'orphan', sourceChatName: 'deleted' },
    ], new Set(['plan', 'notes']));
    expect(squares).toEqual({
      plan: [
        { chatName: 'first', sourceChatName: 'plan' },
        { chatName: 'later', sourceChatName: 'plan' },
        { chatName: 'nested', sourceChatName: 'first' },
      ],
    });
  });

  test('squares widen the card, up to a few and then a count', () => {
    expect(sideChatSquaresWidthPx(0)).toBe(0);
    expect(sideChatSquaresWidthPx(2)).toBe(8 + 20 + 3);
    expect(sideChatSquaresWidthPx(12)).toBe(sideChatSquaresWidthPx(8) + 24);
  });
});
