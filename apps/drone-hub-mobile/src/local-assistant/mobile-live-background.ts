import { AppRegistry, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Crypto from 'expo-crypto';

type NativeLiveVoice = {
  start(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  isActive(sessionId: string): Promise<boolean>;
  addListener(event: 'stopped', listener: (event: { sessionId: string }) => void): { remove(): void };
};
const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<NativeLiveVoice>('DroneLiveVoice') : null;

if (Platform.OS === 'android') {
  // Keep the JS runtime owned by the service. Live deadlines use the native controls clock
  // because RN timers still depend on display frames even with a headless task.
  AppRegistry.registerHeadlessTask('DroneLiveVoice', () => async ({ sessionId }: { sessionId: string }) => {
    if (!native) return;
    await new Promise<void>((resolve) => {
      const finish = () => { listener.remove(); resolve(); };
      const listener = native.addListener('stopped', (event) => {
        if (event.sessionId === sessionId) finish();
      });
      void native.isActive(sessionId).then((active) => { if (!active) finish(); }, finish);
    });
  });
}

export async function startMobileLiveBackground(onStopped: () => void): Promise<() => Promise<void>> {
  if (Platform.OS !== 'android') return async () => {};
  if (!native) throw new Error('Update the Drone Hub mobile app to enable background Live voice.');
  const sessionId = Crypto.randomUUID();
  let started = false;
  const listener = native.addListener('stopped', (event) => {
    if (started && event.sessionId === sessionId) onStopped();
  });
  try {
    await native.start(sessionId);
    started = true;
  } catch (error) {
    listener.remove();
    await native.stop(sessionId).catch(() => undefined);
    throw error;
  }
  return async () => {
    listener.remove();
    await native.stop(sessionId);
  };
}
