import { describe, expect, test } from 'bun:test';
import {
  selectChatComposerEditorModeTarget,
  type ChatComposerEditorModeTarget,
} from '../src/droneHub/chat/chat-composer-editor-mode-shortcut';

function target(id: string, options: { primary?: boolean; eligible?: boolean } = {}): ChatComposerEditorModeTarget {
  return {
    id,
    primary: options.primary === true,
    isEligible: () => options.eligible !== false,
    toggle: () => undefined,
  };
}

describe('full-editor shortcut composer targeting', () => {
  test('keeps targeting the current visible composer after focus moves elsewhere', () => {
    const primary = target('primary', { primary: true });
    const assistant = target('assistant');

    expect(selectChatComposerEditorModeTarget([primary, assistant], 'assistant')).toBe(assistant);
  });

  test('falls back to the visible primary composer when none is current', () => {
    const primary = target('primary', { primary: true });
    const assistant = target('assistant');

    expect(selectChatComposerEditorModeTarget([assistant, primary], null)).toBe(primary);
  });

  test('uses the only visible composer and ignores hidden candidates', () => {
    const hiddenPrimary = target('primary', { primary: true, eligible: false });
    const remote = target('remote');

    expect(selectChatComposerEditorModeTarget([hiddenPrimary, remote], null)).toBe(remote);
  });

  test('does not guess when several non-primary composers are visible', () => {
    expect(selectChatComposerEditorModeTarget([target('left'), target('right')], null)).toBeNull();
  });
});
