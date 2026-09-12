import { expect, mock, test } from 'bun:test';

let shortcutRequests = 0;
let shortcutGranted = true;
let headsetRequests = 0;
let headsetDialog = false;
mock.module('expo-modules-core', () => ({ requireOptionalNativeModule: () => ({
  requestShortcutHeadsetPermission: async () => { shortcutRequests++; return { granted: shortcutGranted }; },
  requestHeadsetPermission: async () => { headsetRequests++; if (headsetDialog) appState.currentState = 'background'; },
}) }));
mock.module('expo-crypto', () => ({ randomUUID: () => 'permission-test' }));

let granted = true;
let requestGranted = true;
let requests = 0;
const listeners = new Set<(state: string) => void>();
const appState = {
  currentState: 'active',
  addEventListener: (_event: string, listener: (state: string) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
};
mock.module('react-native', () => ({ AppState: appState, Platform: { OS: 'android', Version: 36 } }));
mock.module('../src/local-assistant/mobile-live-background', () => ({ startMobileLiveBackground: async () => async () => {} }));
mock.module('expo-audio', () => ({
  getRecordingPermissionsAsync: async () => ({ granted }),
  requestNotificationPermissionsAsync: async () => ({ granted: true }),
  requestRecordingPermissionsAsync: async () => {
    requests++;
    appState.currentState = 'background';
    return { granted: requestGranted };
  },
  setAudioModeAsync: async () => {},
}));
const { prepareMobileLiveAudio } = await import('../src/local-assistant/openMobileLiveAudio');

test('Live skips native permission requests when already granted', async () => {
  await prepareMobileLiveAudio();
  expect(requests).toBe(0);
});

test('Live waits for foreground after a native permission dialog', async () => {
  granted = false;
  let finished = false;
  const preparation = prepareMobileLiveAudio().then(() => { finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(requests).toBe(1);
  expect(finished).toBe(false);
  appState.currentState = 'active';
  for (const listener of listeners) listener('active');
  await preparation;
  expect(finished).toBe(true);
  expect(listeners.size).toBe(0);
});

test('Live reports denied microphone permission', async () => {
  requestGranted = false;
  await expect(prepareMobileLiveAudio()).rejects.toThrow('Allow microphone access');
});


test('Live requests headset access before arming background controls and waits for its dialog to close', async () => {
  granted = true; headsetDialog = true; appState.currentState = 'active';
  const previous = headsetRequests;
  let ready = false;
  const preparation = prepareMobileLiveAudio().then(() => { ready = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(headsetRequests).toBe(previous + 1);
  expect(ready).toBe(false);
  appState.currentState = 'active';
  for (const listener of listeners) listener('active');
  await preparation;
  expect(ready).toBe(true);
  expect(listeners.size).toBe(0);
  headsetDialog = false;
});


test('shortcut obtains Bluetooth permission before a headset connects and reports denial', async () => {
  granted = true; appState.currentState = 'active';
  const previous = headsetRequests;
  await prepareMobileLiveAudio({ headsetShortcut: true });
  expect(shortcutRequests).toBe(1); expect(headsetRequests).toBe(previous);
  shortcutGranted = false;
  try { await expect(prepareMobileLiveAudio({ headsetShortcut: true })).rejects.toThrow('Allow Nearby devices access'); }
  finally { shortcutGranted = true; }
});
