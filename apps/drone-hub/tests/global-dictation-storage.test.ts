import { describe, expect, test } from 'bun:test';
import {
  GLOBAL_DICTATION_STORAGE_KEY,
  GLOBAL_DICTATION_MAX_CHARS,
  normalizeGlobalDictationText,
  readGlobalDictationState,
  writeGlobalDictationState,
} from '../src/droneHub/dictation/global-dictation-storage';

describe('global dictation persistence', () => {
  test('normalizes stored text and bounds its size', () => {
    expect(normalizeGlobalDictationText(null)).toBe('');
    expect(normalizeGlobalDictationText('dictated text')).toBe('dictated text');
    expect(normalizeGlobalDictationText('x'.repeat(GLOBAL_DICTATION_MAX_CHARS + 10))).toHaveLength(
      GLOBAL_DICTATION_MAX_CHARS,
    );
  });

  test('restores a saved editor draft and removes empty closed state', () => {
    const values = new Map<string, string>();
    const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    try {
      writeGlobalDictationState({ open: true, text: 'remember this' });
      expect(readGlobalDictationState()).toEqual({ open: true, text: 'remember this' });

      writeGlobalDictationState({ open: true, text: '' });
      expect(readGlobalDictationState()).toEqual({ open: true, text: '' });

      values.set(GLOBAL_DICTATION_STORAGE_KEY, '{"open":true,"text":{"unexpected":true}}');
      expect(readGlobalDictationState()).toEqual({ open: true, text: '' });

      writeGlobalDictationState({ open: false, text: '' });
      expect(values.has(GLOBAL_DICTATION_STORAGE_KEY)).toBe(false);
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
      } else {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      }
    }
  });
});
