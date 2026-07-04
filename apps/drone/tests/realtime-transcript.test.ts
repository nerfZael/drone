import { describe, expect, test } from 'bun:test';

import { realtimeStopTranscript, realtimeStreamingTranscript } from '../src/hub/realtime-transcript';

describe('realtime transcript command filtering', () => {
  test('keeps normal partial transcript text visible', () => {
    expect(realtimeStreamingTranscript('  list   my   drones  ')).toEqual({
      stop: false,
      text: 'list my drones',
      hasText: true,
    });
  });

  test('clears command-only stop transcript deltas', () => {
    expect(realtimeStreamingTranscript("that's it")).toEqual({
      stop: true,
      text: '',
      hasText: false,
    });
  });

  test('keeps useful speech before a stop command and strips the command', () => {
    expect(realtimeStreamingTranscript("list my drones, that's it")).toEqual({
      stop: true,
      text: 'list my drones',
      hasText: true,
    });
    expect(realtimeStopTranscript('list my drones that is it')).toEqual({
      stop: true,
      text: 'list my drones',
      hasText: true,
    });
  });
});
