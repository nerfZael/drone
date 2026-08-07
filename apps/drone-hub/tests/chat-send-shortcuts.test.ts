import { describe, expect, test } from 'bun:test';

import { chatSendShortcut, isChatEditorQueueShortcut } from '../src/droneHub/chat';

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
    expect(shortcut('Enter', { altKey: true })).toBe('asap');
  });

  test('queues with Tab', () => {
    expect(shortcut('Tab')).toBe('queue');
  });

  test('starts a new chat with Ctrl+Enter or Command+Enter', () => {
    expect(shortcut('Enter', { ctrlKey: true })).toBe('new-chat');
    expect(shortcut('Enter', { metaKey: true })).toBe('new-chat');
  });

  test('queues Ctrl+Enter or Command+Enter in editor mode', () => {
    const editorShortcut = (overrides: Partial<Parameters<typeof isChatEditorQueueShortcut>[0]>) =>
      isChatEditorQueueShortcut({
        key: 'Enter',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...overrides,
      });

    expect(editorShortcut({ ctrlKey: true })).toBe(true);
    expect(editorShortcut({ metaKey: true })).toBe(true);
    expect(editorShortcut({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(editorShortcut({ metaKey: true, altKey: true })).toBe(false);
    expect(editorShortcut({ key: 'Enter' })).toBe(false);
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
