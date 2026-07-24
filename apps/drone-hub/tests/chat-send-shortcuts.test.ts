import { describe, expect, test } from 'bun:test';

import { chatSendShortcut } from '../src/droneHub/chat';

function shortcut(key: string, overrides: Partial<Parameters<typeof chatSendShortcut>[0]> = {}) {
  return chatSendShortcut({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    hasContent: true,
    ...overrides,
  });
}

describe('chat send shortcuts', () => {
  test('sends Enter as ASAP', () => {
    expect(shortcut('Enter')).toBe('asap');
  });

  test('queues with Tab, Ctrl+Enter, or Command+Enter', () => {
    expect(shortcut('Tab')).toBe('queue');
    expect(shortcut('Enter', { ctrlKey: true })).toBe('queue');
    expect(shortcut('Enter', { metaKey: true })).toBe('queue');
  });

  test('keeps Shift+Enter and Shift+Tab available to the editor', () => {
    expect(shortcut('Enter', { shiftKey: true })).toBeNull();
    expect(shortcut('Tab', { shiftKey: true })).toBeNull();
  });

  test('does not replace browser shortcuts that include Tab', () => {
    expect(shortcut('Tab', { ctrlKey: true })).toBeNull();
    expect(shortcut('Tab', { metaKey: true })).toBeNull();
    expect(shortcut('Tab', { altKey: true })).toBeNull();
  });

  test('does not consume send shortcuts when there is no content', () => {
    expect(shortcut('Enter', { hasContent: false })).toBeNull();
    expect(shortcut('Tab', { hasContent: false })).toBeNull();
  });
});
