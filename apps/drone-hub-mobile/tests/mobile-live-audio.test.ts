import { expect, mock, test } from 'bun:test';

const calls: string[] = [];
let failMicrophone = false;
let stopped!: () => void;
const microphone = {
  getTracks: () => [{ stop: () => calls.push('track.stop') }],
  release: () => calls.push('microphone.release'),
};
mock.module('react-native', () => ({ Platform: { OS: 'android' }, AppState: { currentState: 'active' } }));
mock.module('expo-audio', () => ({
  getRecordingPermissionsAsync: async () => ({ granted: true }),
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  requestNotificationPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async (mode: { shouldPlayInBackground: boolean }) => calls.push(`background:${mode.shouldPlayInBackground}`),
}));
mock.module('../src/local-assistant/mobile-live-background', () => ({
  startMobileLiveBackground: async (onStopped: () => void) => {
    calls.push('service.start'); stopped = onStopped;
    return async () => { calls.push('service.stop'); };
  },
}));
mock.module('react-native-webrtc', () => ({
  mediaDevices: { getUserMedia: async () => {
    calls.push('microphone.open');
    if (failMicrophone) throw new Error('Microphone unavailable');
    return microphone;
  } },
  RTCPeerConnection: class { close() { calls.push('peer.close'); } },
}));
const { openMobileLiveAudio } = await import('../src/local-assistant/openMobileLiveAudio');

test('Live starts foreground protection before audio and removes it after releasing audio', async () => {
  let stopRequested = false;
  const audio = await openMobileLiveAudio(() => { stopRequested = true; });
  expect(calls).toEqual(['service.start', 'background:true', 'microphone.open']);
  stopped();
  expect(stopRequested).toBe(true);
  await audio.release();
  expect(calls.slice(3)).toEqual(['track.stop', 'peer.close', 'microphone.release', 'background:false', 'service.stop']);
});

test('Live startup failure releases background protection', async () => {
  calls.length = 0;
  failMicrophone = true;
  await expect(openMobileLiveAudio()).rejects.toThrow('Microphone unavailable');
  expect(calls).toEqual(['service.start', 'background:true', 'microphone.open', 'background:false', 'service.stop']);
});
