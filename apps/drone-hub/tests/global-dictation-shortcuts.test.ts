import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalDictationOverlay } from '../src/droneHub/dictation/GlobalDictationOverlay';
import { GLOBAL_DICTATION_STORAGE_KEY } from '../src/droneHub/dictation/global-dictation-storage';
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

  test('maps numpad zero through five to their destinations', () => {
    expect(shortcut('Numpad0')).toEqual({ destination: 'current-chat' });
    expect(shortcut('Numpad1')).toEqual({ destination: 'root-drone' });
    expect(shortcut('Numpad2')).toEqual({ destination: 'group-drone' });
    expect(shortcut('Numpad3')).toEqual({ destination: 'new-chat' });
    expect(shortcut('Numpad4')).toEqual({ destination: 'clone-chat' });
    expect(shortcut('Numpad5')).toEqual({ destination: 'companion' });
  });

  test('does not intercept the top number row or modified numpad keys', () => {
    expect(shortcut('Digit1')).toBeNull();
    expect(shortcut('Numpad1', { ctrlKey: true })).toBeNull();
    expect(shortcut('NumpadAdd', { shiftKey: true })).toBeNull();
  });

  test('shows Companion as the sixth scratchpad destination', () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) =>
          key === GLOBAL_DICTATION_STORAGE_KEY ? '{"open":true,"text":"Review this"}' : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });

    try {
      const html = renderToStaticMarkup(
        React.createElement(GlobalDictationOverlay, {
          activeChatLabel: 'Drone / default',
          resolveTarget: () => ({ ok: false, error: 'Not used' }),
          send: async () => ({ ok: true }),
        }),
      );

      expect(html).toContain('Numpad 5: send to companion');
      expect(html).toContain('>Companion</span>');
      expect(html).toContain('grid-cols-6');
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
      } else {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      }
    }
  });
});
