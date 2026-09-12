import { throwIfAborted } from '@drone/device-protocol';
import type { LivePcmAudio, LivePcmCallbacks } from '@drone/assistant-chat';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Crypto from 'expo-crypto';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, requestNotificationPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { AppState, Platform } from 'react-native';
import { ensureMobileRecordingPermission, ensureMobileBackgroundRecordingPermission } from './mobile-recording-permission';
import { startMobileLiveBackground } from './mobile-live-background';

export async function prepareMobileLiveAudio() {
  const permission = await ensureMobileRecordingPermission({
    getPermission: getRecordingPermissionsAsync,
    requestPermission: requestRecordingPermissionsAsync,
  });
  if (!permission.granted) throw new Error('Allow microphone access in your phone settings to use Live voice.');
  await ensureMobileBackgroundRecordingPermission({
    platform: Platform.OS, platformVersion: Number(Platform.Version),
    requestPermission: requestNotificationPermissionsAsync,
  });
  if (Platform.OS === 'android') {
    const native = requireOptionalNativeModule<NativePcm>('DroneLiveVoice');
    await native?.requestHeadsetPermission?.();
  }
  // Android permission activities temporarily background the app. Wait for their
  // dismissal before opening audio, but never start recording in the background.
  if (AppState.currentState !== 'active') {
    const resumed = await new Promise<boolean>((resolve) => {
      const finish = (active: boolean) => {
        clearTimeout(timer);
        subscription.remove();
        resolve(active);
      };
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') finish(true);
      });
      const timer = setTimeout(() => finish(AppState.currentState === 'active'), 3_000);
      if (AppState.currentState === 'active') finish(true);
    });
    if (!resumed) throw new Error('Return to Drone Hub and try Live voice again.');
  }
}

type NativePcm = {
  requestHeadsetPermission?(): Promise<void>;
  preparePcmRoute?(id: string): Promise<boolean>;
  cancelPcmRoute?(id: string): Promise<void>;
  releasePcmRoute?(id: string): Promise<void>;
  startPcm(id: string): Promise<void>;
  stopPcm(id: string): Promise<void>;
  playPcm(id: string, audio: string): Promise<void>;
  mutePcm(id: string, muted: boolean): Promise<void>;
  addListener(event: string, callback: (event: { id: string; audio?: string; error?: string }) => void): { remove(): void };
};

export async function openMobileLiveAudio(callbacks: LivePcmCallbacks, onStopped: () => void = () => {},
  options: { backgroundAlreadyStarted?: boolean; onCaptureStopped?(): Promise<void> } = {}): Promise<LivePcmAudio> {
  throwIfAborted(callbacks.signal);
  const native = requireOptionalNativeModule<NativePcm>('DroneLiveVoice');
  if (!native?.startPcm) throw new Error('Update the Drone Hub mobile app to use buffered Live voice.');
  const id = Crypto.randomUUID();
  const stopBackground = options.backgroundAlreadyStarted ? async () => {} : await startMobileLiveBackground(onStopped);
  let closed = false;
  let headsetOwnsMode = false;
  const subscriptions: { remove(): void }[] = [];
  let startup: Promise<void> = Promise.resolve();
  let releasePromise: Promise<void> | undefined;
  const release = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    closed = true;
    callbacks.signal?.removeEventListener('abort', abort);
    subscriptions.forEach((subscription) => subscription.remove());
    releasePromise = (async () => {
      // Cancel a pending headset bind/connect, but stop an active microphone before releasing its route.
      await native.cancelPcmRoute?.(id).catch(() => undefined);
      // Native microphone setup cannot be cancelled mid-call; wait before undoing its effects.
      await startup.catch(() => undefined);
      try {
        await native.stopPcm(id);
        // The caller still owns the microphone lease and audio mode here.
        await options.onCaptureStopped?.();
      }
      finally {
        try {
          if (!headsetOwnsMode) await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false });
        } finally {
          try { await native.releasePcmRoute?.(id); }
          finally { await stopBackground(); }
        }
      }
    })();
    return releasePromise;
  };
  const abort = () => { void release().catch(() => undefined); };
  callbacks.signal?.addEventListener('abort', abort, { once: true });
  startup = Promise.resolve().then(async () => {
    throwIfAborted(callbacks.signal);
    subscriptions.push(native.addListener('pcmAudio', (event) => {
      if (!closed && event.id === id && event.audio) callbacks.onAudio(event.audio);
    }));
    subscriptions.push(native.addListener('pcmError', (event) => {
      if (!closed && event.id === id) callbacks.onError(event.error ?? 'Live microphone failed.');
    }));
    headsetOwnsMode = await native.preparePcmRoute?.(id) ?? false;
    throwIfAborted(callbacks.signal);
    if (!headsetOwnsMode) await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: options.backgroundAlreadyStarted || Platform.OS === 'android',
      shouldRouteThroughEarpiece: false, interruptionMode: 'doNotMix' });
    throwIfAborted(callbacks.signal);
    await native.startPcm(id);
    throwIfAborted(callbacks.signal);
  });
  try {
    await startup;
    const report = (error: unknown) => { if (!closed) callbacks.onError(error instanceof Error ? error.message : 'Live audio failed.'); };
    return {
      mute(muted) { if (!closed) void native.mutePcm(id, muted).catch(report); },
      play(audio) { if (!closed) void native.playPcm(id, audio).catch(report); },
      async resume() {},
      release,
    };
  } catch (error) { await release(); throw error; }
}
