import { Platform } from 'react-native';
import { MobileLiveClock } from './mobile-live-clock';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Crypto from 'expo-crypto';
import { startMobileLiveBackground } from './mobile-live-background';

export type LiveMediaAction = 'play' | 'pause' | 'stop' | 'end';
export type LiveMediaState = 'connecting' | 'recording' | 'paused';
type NativeControls = {
  armControls(id: string): Promise<void>;
  armStandbyControls?(id: string): Promise<void>;
  updateControls(id: string, state: LiveMediaState): Promise<void>;
  disarmControls(id: string): Promise<void>;
  playCue(id: string, cue: 'recording' | 'stopped'): Promise<void>;
  addListener(event: 'mediaControl', callback: (event: { id: string; action: LiveMediaAction }) => void): { remove(): void };
  addListener(event: 'controlTick', callback: (event: { id: string }) => void): { remove(): void };
};

/** A media session survives paused Live connections, until End voice. */
export async function openMobileLiveControls(onAction: (action: LiveMediaAction) => void, standby = false) {
  const native = requireOptionalNativeModule<NativeControls>('DroneLiveVoice');
  if (!native?.armControls) throw new Error('Update the mobile app to use Live headset controls.');
  const id = Crypto.randomUUID();
  const stopBackground = await startMobileLiveBackground(() => onAction('end'));
  const clock = new MobileLiveClock();
  let tickListener: { remove(): void } | undefined;
  let closed = false;
  let listener: { remove(): void } | undefined;
  let releasing: Promise<void> | undefined;
  const release = () => {
    if (releasing) return releasing;
    closed = true; listener?.remove(); tickListener?.remove(); clock.close();
    releasing = (async () => { try { await native.disarmControls(id); } finally { await stopBackground(); } })();
    return releasing;
  };
  try {
    if (Platform.OS === 'android') tickListener = native.addListener('controlTick', (event) => {
      if (!closed && event.id === id) clock.tick();
    });
    listener = native.addListener('mediaControl', (event) => {
      if (!closed && event.id === id) onAction(event.action);
    });
    if (standby) {
      if (!native.armStandbyControls) throw new Error('Update the Android app to enable the headset shortcut.');
      await native.armStandbyControls(id);
    } else await native.armControls(id);
    return {
      schedule: clock.schedule,
      async update(state: LiveMediaState) { if (!closed) await native.updateControls(id, state); },
      async cue(cue: 'recording' | 'stopped') { if (!closed) await native.playCue(id, cue); },
      release,
    };
  } catch (error) { await release(); throw error; }
}
export type MobileLiveControls = Awaited<ReturnType<typeof openMobileLiveControls>>;
