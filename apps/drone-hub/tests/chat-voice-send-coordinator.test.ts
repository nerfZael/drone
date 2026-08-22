import { describe, expect, test } from 'bun:test';

import { ChatVoiceSendCoordinator } from '../src/droneHub/chat/chat-voice-send-coordinator';

describe('ChatVoiceSendCoordinator', () => {
  test('queues send until a manually stopped recording finishes transcribing', () => {
    const coordinator = new ChatVoiceSendCoordinator<string>();
    const token = coordinator.begin(false);

    expect(token).not.toBeNull();
    expect(coordinator.requestSend('send after transcript')).toBe('queued-after-transcription');
    expect(coordinator.finish(token!)).toBe('send after transcript');
  });

  test('does not queue a duplicate while transcription already intends to send', () => {
    const coordinator = new ChatVoiceSendCoordinator<string>();
    const token = coordinator.begin(true);

    expect(coordinator.requestSend('duplicate')).toBe('already-sending');
    expect(coordinator.finish(token!)).toBeNull();
  });

  test('keeps only the latest deferred send and clears it on cancellation', () => {
    const coordinator = new ChatVoiceSendCoordinator<string>();
    const token = coordinator.begin(false);

    coordinator.requestSend('first');
    coordinator.requestSend('latest');
    coordinator.cancel();

    expect(coordinator.isCurrent(token!)).toBe(false);
    expect(coordinator.finish(token!)).toBeNull();
    expect(coordinator.requestSend('next')).toBe('run-now');
  });
});
