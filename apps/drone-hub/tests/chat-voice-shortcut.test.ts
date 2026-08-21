import { describe, expect, test } from 'bun:test';

import {
  CHAT_VOICE_SHORTCUT_DOUBLE_TAP_MS,
  isChatVoiceShortcutDoubleTap,
} from '../src/droneHub/chat/chat-voice-shortcut';

describe('chat voice shortcut', () => {
  test('recognizes a rapid second press as a double tap', () => {
    expect(
      isChatVoiceShortcutDoubleTap(
        1_000,
        1_000 + CHAT_VOICE_SHORTCUT_DOUBLE_TAP_MS,
      ),
    ).toBe(true);
    expect(
      isChatVoiceShortcutDoubleTap(
        1_000,
        1_001 + CHAT_VOICE_SHORTCUT_DOUBLE_TAP_MS,
      ),
    ).toBe(false);
  });

  test('rejects missing or out-of-order first presses', () => {
    expect(isChatVoiceShortcutDoubleTap(0, 100)).toBe(false);
    expect(isChatVoiceShortcutDoubleTap(1_000, 999)).toBe(false);
  });
});
