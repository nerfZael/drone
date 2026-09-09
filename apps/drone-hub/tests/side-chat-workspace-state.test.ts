import { afterEach, describe, expect, test } from 'bun:test';
import {
  measureSideChatBounds,
  parseSideChatWorkspaceState,
  readSideChatWorkspaceState,
  renameSideChatWorkspaceChat,
  restoreSideChatBounds,
  saveSideChatWorkspaceState,
} from '../src/droneHub/app/side-chat-workspace-state';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function memoryStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
}

const first = { x: 460, y: 75, width: 380, height: 520 };
const second = { x: 120, y: 95, width: 320, height: 440 };

describe('side chat workspace persistence', () => {
  test('renaming a chat retains the previous main selection and saved geometry', () => {
    memoryStorage();
    saveSideChatWorkspaceState('a', { previousMainChat: 'review', floatingBounds: { review: first } });
    renameSideChatWorkspaceChat('a', 'review', 'renamed');
    expect(readSideChatWorkspaceState('a')).toEqual({ previousMainChat: 'renamed', floatingBounds: { renamed: first } });
  });
  test('retains independent floating positions and the previous main chat across drone navigation', () => {
    memoryStorage();
    saveSideChatWorkspaceState('a', { previousMainChat: 'review' });
    saveSideChatWorkspaceState('a', { floatingBounds: { 'side-1': first } });
    saveSideChatWorkspaceState('b', { previousMainChat: 'default', floatingBounds: { 'side-1': second } });
    // Promoting a second side chat must not erase the first return position.
    saveSideChatWorkspaceState('a', { floatingBounds: { 'side-2': second } });
    expect(readSideChatWorkspaceState('a')).toEqual({
      previousMainChat: 'review', floatingBounds: { 'side-1': first, 'side-2': second },
    });
    expect(readSideChatWorkspaceState('b').floatingBounds['side-1']).toEqual(second);
    // A later promotion remembers the user's new normal main chat.
    saveSideChatWorkspaceState('a', { previousMainChat: 'planning' });
    expect(readSideChatWorkspaceState('a').floatingBounds['side-1']).toEqual(first);
    expect(readSideChatWorkspaceState('a').previousMainChat).toBe('planning');
  });

  test('ignores corrupt or invalid saved bounds', () => {
    expect(parseSideChatWorkspaceState('{')).toEqual({ previousMainChat: 'default', floatingBounds: {} });
    expect(parseSideChatWorkspaceState(JSON.stringify({
      previousMainChat: 42,
      floatingBounds: { good: first, negative: { ...first, width: -1 }, missing: { x: 1 }, nil: null },
    }))).toEqual({ previousMainChat: 'default', floatingBounds: { good: first } });
  });

  test('keeps chat switching usable when storage is blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    expect(() => saveSideChatWorkspaceState('a', { previousMainChat: 'review' })).not.toThrow();
    expect(readSideChatWorkspaceState('a').previousMainChat).toBe('default');
  });
});

test('restores the exact floating position when it fits', () => {
  expect(restoreSideChatBounds(first, { width: 1200, height: 800 })).toEqual(first);
});

test('keeps restored windows reachable after shrinking the workspace', () => {
  expect(restoreSideChatBounds(first, { width: 300, height: 250 })).toEqual({ x: 0, y: 0, width: 300, height: 250 });
  expect(restoreSideChatBounds(first, { width: 600, height: 600 })).toEqual({ ...first, x: 220 });
  expect(restoreSideChatBounds({ ...first, x: -20, y: -50 }, { width: 1200, height: 800 })).toEqual({ ...first, x: 0, y: 0 });
});

test('measures the floating frame including its border, relative to the workspace', () => {
  const workspace = { getBoundingClientRect: () => ({ x: 200, y: 100 }) } as Element;
  const frame = { getBoundingClientRect: () => ({ x: 680, y: 130, width: 320, height: 440 }) };
  const group = {
    closest: (selector: string) => selector === '.dv-resize-container' ? frame : null,
    getBoundingClientRect: () => ({ x: 681, y: 131, width: 318, height: 438 }),
  } as Element;
  expect(measureSideChatBounds(group, workspace)).toEqual({ x: 480, y: 30, width: 320, height: 440 });
});

test('uses the group position when promoting a side chat that was docked', () => {
  const workspace = { getBoundingClientRect: () => ({ x: 200, y: 100 }) } as Element;
  const group = {
    closest: () => null,
    getBoundingClientRect: () => ({ x: 680, y: 130, width: 320, height: 440 }),
  } as unknown as Element;
  expect(measureSideChatBounds(group, workspace)).toEqual({ x: 480, y: 30, width: 320, height: 440 });
});
