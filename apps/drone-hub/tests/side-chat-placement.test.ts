import { expect, test } from 'bun:test';
import { placeSideChat } from '../src/droneHub/app/side-chat-placement';

test('places compact side chats beside existing chats when space is available', () => {
  const workspace = { width: 1200, height: 900 };
  const main = { x: 0, y: 0, width: 500, height: 900 };
  const first = placeSideChat(workspace, [main], 0);
  expect(first.width).toBe(320);
  expect(first.height).toBe(225);
  expect(first.x).toBeGreaterThanOrEqual(500);
  const second = placeSideChat(workspace, [main, first], 1);
  expect(
    second.x >= first.x + first.width ||
      second.x + second.width <= first.x ||
      second.y >= first.y + first.height,
  ).toBe(true);
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
