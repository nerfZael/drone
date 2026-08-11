import { expect, test } from 'bun:test';
import { browserMicrophoneCoordinator } from '../src/droneHub/chat/browser-microphone-coordinator';

test('allows only one browser microphone owner at a time', () => {
  const first = browserMicrophoneCoordinator.acquire('continuous-dictation');
  expect(first?.owner).toBe('continuous-dictation');
  expect(browserMicrophoneCoordinator.acquire('voice-message')).toBeNull();

  first?.release();
  const second = browserMicrophoneCoordinator.acquire('voice-message');
  expect(second?.owner).toBe('voice-message');
  second?.release();
  expect(browserMicrophoneCoordinator.getSnapshot()).toBeNull();
});
