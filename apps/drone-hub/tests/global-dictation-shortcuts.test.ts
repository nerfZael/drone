import { describe, expect, test } from 'bun:test';
import { globalDictationShortcutAction } from '../src/droneHub/dictation/global-dictation-shortcuts';

function shortcut(code: string, overrides: Partial<KeyboardEvent> = {}) {
  return globalDictationShortcutAction({
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  });
}

describe('global dictation numpad shortcuts', () => {
  test('maps the recording and panel controls by physical numpad code', () => {
    expect(shortcut('NumpadAdd')).toBe('toggle-recording');
    expect(shortcut('NumpadSubtract')).toBe('cancel-recording');
    expect(shortcut('NumpadDecimal')).toBe('close');
  });

  test('maps numpad zero through four to their destinations', () => {
    expect(shortcut('Numpad0')).toEqual({ destination: 'current-chat' });
    expect(shortcut('Numpad1')).toEqual({ destination: 'root-drone' });
    expect(shortcut('Numpad2')).toEqual({ destination: 'group-drone' });
    expect(shortcut('Numpad3')).toEqual({ destination: 'new-chat' });
    expect(shortcut('Numpad4')).toEqual({ destination: 'clone-chat' });
  });

  test('does not intercept the top number row or modified numpad keys', () => {
    expect(shortcut('Digit1')).toBeNull();
    expect(shortcut('Numpad1', { ctrlKey: true })).toBeNull();
    expect(shortcut('NumpadAdd', { shiftKey: true })).toBeNull();
  });
});
