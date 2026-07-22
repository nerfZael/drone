import { describe, expect, test } from 'bun:test';
import { chatResponseStopVisible } from '../src/droneHub/chat/chat-response-stop-visible';

describe('chat response stop visibility', () => {
  test('hides the response stop action while voice recording is active', () => {
    expect(
      chatResponseStopVisible({
        waiting: true,
        hasStopAction: true,
        voiceRecordingActive: false,
      }),
    ).toBe(true);
    expect(
      chatResponseStopVisible({
        waiting: true,
        hasStopAction: true,
        voiceRecordingActive: true,
      }),
    ).toBe(false);
  });

  test('keeps the response stop action hidden when there is no active response', () => {
    expect(
      chatResponseStopVisible({
        waiting: false,
        hasStopAction: true,
        voiceRecordingActive: false,
      }),
    ).toBe(false);
  });
});
