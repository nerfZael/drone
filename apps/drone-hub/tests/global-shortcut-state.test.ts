import { describe, expect, test } from 'bun:test';

import {
  activeGlobalShortcutBindings,
  applyGlobalShortcutSettings,
  clearActiveGlobalShortcutSettings,
} from '../src/droneHub/app/global-shortcut-state';

const NUMPAD_ONE = {
  key: 'num1',
  mod: false,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
};

describe('global shortcut state', () => {
  test('exposes only host-active bindings and clears them on disconnect', () => {
    applyGlobalShortcutSettings({
      ok: true,
      bindings: {
        toggleChatVoiceRecording: NUMPAD_ONE,
        toggleCompanion: { ...NUMPAD_ONE, key: 'num2' },
      },
      status: {
        running: true,
        error: '',
        warning: '',
        actions: {
          toggleChatVoiceRecording: { active: true, error: '' },
          toggleCompanion: { active: false, error: 'Unsupported key' },
        },
      },
    });

    expect(activeGlobalShortcutBindings()).toEqual({
      toggleChatVoiceRecording: NUMPAD_ONE,
    });

    clearActiveGlobalShortcutSettings();
    expect(activeGlobalShortcutBindings()).toEqual({});
  });
});
