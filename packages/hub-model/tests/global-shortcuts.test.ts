import { describe, expect, test } from 'bun:test';
import {
  droneHubShortcutBindingSignature,
  sanitizeDroneHubGlobalShortcutBindings,
} from '../src/global-shortcuts';

describe('Drone Hub global shortcut contract', () => {
  test('keeps supported action bindings and drops unknown or invalid entries', () => {
    const bindings = sanitizeDroneHubGlobalShortcutBindings({
      toggleChatVoiceRecording: {
        key: 'NUM1',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
      unknownAction: {
        key: 'q',
      },
      toggleCompanion: {
        key: 'Control',
      },
    });

    expect(bindings).toEqual({
      toggleChatVoiceRecording: {
        key: 'num1',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
    });
    expect(droneHubShortcutBindingSignature(bindings.toggleChatVoiceRecording)).toBe(
      '0:0:0:0:0:num1',
    );
  });
});
