import React from 'react';
import { getSpeechMuted, subscribeSpeechMuted } from '../media/speech-playback';

// Companion's own volume, applied on top of the system volume like a media player's slider.
// Above 100% it amplifies, because generated speech is often quieter than other desktop audio.
export const COMPANION_VOLUME_MAX = 2;
const KEY = 'drone-hub:companion-volume';
const listeners = new Set<() => void>();
let volume: number | null = null;

const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(COMPANION_VOLUME_MAX, value)) : 1;

export function getCompanionVolume(): number {
  if (volume === null) {
    try { volume = clamp(Number(window.localStorage.getItem(KEY) ?? 1)); } catch { volume = 1; }
  }
  return volume;
}

export function setCompanionVolume(value: number): void {
  volume = clamp(value);
  try { window.localStorage.setItem(KEY, String(volume)); } catch { /* The setting still applies to this session. */ }
  for (const listener of [...listeners]) listener();
}

export function subscribeCompanionVolume(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCompanionVolume(): number {
  return React.useSyncExternalStore(subscribeCompanionVolume, getCompanionVolume, () => 1);
}

/** Route a context's playback through the Companion volume; returns the node to connect sources to. */
export function connectCompanionVolume(context: AudioContext): { input: AudioNode; release(): void } {
  const gain = context.createGain();
  // Amplified speech can exceed full scale; limit it instead of letting it clip.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.003; limiter.release.value = 0.1;
  gain.connect(limiter);
  limiter.connect(context.destination);
  // Muting speech silences the voice but not the cue sounds, which do not pass through here.
  const apply = () => { gain.gain.value = getSpeechMuted() ? 0 : getCompanionVolume(); };
  apply();
  const unsubscribeVolume = subscribeCompanionVolume(apply);
  const unsubscribeMuted = subscribeSpeechMuted(apply);
  return { input: gain, release() { unsubscribeVolume(); unsubscribeMuted(); gain.disconnect(); limiter.disconnect(); } };
}
