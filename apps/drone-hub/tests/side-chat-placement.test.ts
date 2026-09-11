import { expect, test } from 'bun:test';
import { placeSideChat } from '../src/droneHub/app/side-chat-placement';

test('stacks new chats from the bottom-right corner upward', () => {
  const workspace = { width: 1200, height: 900 };
  const first = placeSideChat(workspace, [], 0);
  expect(first).toEqual({ x: 880, y: 675, width: 320, height: 225 });
  const second = placeSideChat(workspace, [first], 1);
  expect(second.x).toBe(first.x);
  expect(second.y + second.height).toBeLessThanOrEqual(first.y);
  const third = placeSideChat(workspace, [first, second], 2);
  expect(third.x).toBe(first.x);
  expect(third.y + third.height).toBeLessThanOrEqual(second.y);
});

test('starts a new column to the left, at the bottom, once the column is full', () => {
  const workspace = { width: 1200, height: 900 };
  const placed: ReturnType<typeof placeSideChat>[] = [];
  for (let index = 0; index < 4; index++) placed.push(placeSideChat(workspace, placed, index));
  expect(placed[3].x + placed[3].width).toBeLessThanOrEqual(placed[0].x);
  expect(placed[3].y + placed[3].height).toBe(workspace.height);
  for (let index = 1; index < placed.length; index++)
    for (let other = 0; other < index; other++) {
      const a = placed[index];
      const b = placed[other];
      const disjoint = a.x >= b.x + b.width || a.x + a.width <= b.x || a.y >= b.y + b.height || a.y + a.height <= b.y;
      expect(disjoint).toBe(true);
    }
});

test('packs above a window the user moved into the next column', () => {
  const workspace = { width: 1200, height: 900 };
  const moved = { x: 400, y: 500, width: 320, height: 225 };
  const placed = [moved];
  for (let index = 0; index < 3; index++) placed.push(placeSideChat(workspace, placed, index));
  expect(placed.slice(1).map((rect) => rect.x)).toEqual([880, 880, 880]);
  const next = placeSideChat(workspace, placed, 3);
  expect(next.x).toBe(552);
  expect(next.y + next.height).toBeLessThanOrEqual(moved.y);
});

test('uses a quarter of the workspace height, at least 220, capped by the workspace', () => {
  for (const height of [500, 700, 900, 1200, 1600]) {
    expect(placeSideChat({ width: 1200, height }, [], 0).height).toBe(Math.max(220, Math.round(height / 4)));
  }
  expect(placeSideChat({ width: 900, height: 200 }, [], 0).height).toBe(200);
});

test('offsets overlapping windows when the main chat fills the workspace', () => {
  const workspace = { width: 900, height: 700 };
  const main = { x: 0, y: 0, ...workspace };
  const first = placeSideChat(workspace, [main], 0);
  const second = placeSideChat(workspace, [main, first], 1);
  expect(second.x).not.toBe(first.x);
  expect(second.y).toBeGreaterThan(first.y);
  expect(second.x + second.width).toBeLessThanOrEqual(workspace.width);
  expect(second.y + second.height).toBeLessThanOrEqual(workspace.height);
});

test('keeps the panel within a small viewport', () => {
  expect(placeSideChat({ width: 280, height: 190 }, [], 5)).toEqual({
    x: 0,
    y: 0,
    width: 280,
    height: 190,
  });
});

test('does not hide an existing window when a cascade slot is reused after deletion', () => {
  const workspace = { width: 900, height: 700 };
  const main = { x: 0, y: 0, ...workspace };
  const remaining = placeSideChat(workspace, [main], 1);
  const next = placeSideChat(workspace, [main, remaining], 1);
  expect([next.x, next.y]).not.toEqual([remaining.x, remaining.y]);
});

test('uses the available offset even when it is smaller than the usual cascade step', () => {
  const workspace = { width: 340, height: 230 };
  const main = { x: 0, y: 0, ...workspace };
  const first = placeSideChat(workspace, [main], 0);
  const next = placeSideChat(workspace, [main, first], 1);
  expect([next.x, next.y]).not.toEqual([first.x, first.y]);
  expect(next.x + next.width).toBeLessThanOrEqual(workspace.width);
  expect(next.y + next.height).toBeLessThanOrEqual(workspace.height);
});
