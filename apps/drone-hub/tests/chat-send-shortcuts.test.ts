import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_CHAT_MESSAGE_DELIVERY_MODE,
  chatSendShortcut,
  isChatEditorQueueShortcut,
} from '../src/droneHub/chat';

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
  test('uses queued delivery by default', () => {
    expect(DEFAULT_CHAT_MESSAGE_DELIVERY_MODE).toBe('queue');
  });

  test('queues with Enter', () => {
    expect(shortcut('Enter')).toBe('queue');
    expect(shortcut('Enter', { altKey: true })).toBe('queue');
  });

  test('sends ASAP with Tab', () => {
    expect(shortcut('Tab')).toBe('asap');
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

  test('keeps Tab as indentation in the full text editor', () => {
    const editor = readFileSync(
      new URL('../src/droneHub/chat/ChatComposerEditor.tsx', import.meta.url),
      'utf8',
    );

    expect(editor).not.toContain('monaco.KeyCode.Tab');
    expect(editor).toContain("const spaces = '  '");
    expect(editor).toContain('tabSize: 2');
    expect(editor.match(/aria-keyshortcuts="Control\+Enter Meta\+Enter"/g)).toHaveLength(2);
  });

  test('grows the full text editor with its content up to four fifths of the chat', () => {
    const editor = readFileSync(
      new URL('../src/droneHub/chat/ChatComposerEditor.tsx', import.meta.url),
      'utf8',
    );
    const chatSurface = readFileSync(
      new URL('../src/droneHub/chat/ChatSurface.tsx', import.meta.url),
      'utf8',
    );

    expect(editor).toContain('editor.onDidContentSizeChange');
    expect(editor).toContain('height: editorHeight || CHAT_COMPOSER_EDITOR_MIN_HEIGHT');
    expect(editor).toContain("const CHAT_COMPOSER_EDITOR_MIN_HEIGHT = '6rem'");
    expect(editor).toContain("const CHAT_COMPOSER_EDITOR_MAX_HEIGHT = '80cqh'");
    expect(chatSurface).toContain('[container-type:size]');
    expect(editor).not.toContain('h-[clamp(18rem,36vh,28rem)]');
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
