const activeSpeechAudio = new Set<HTMLAudioElement>();
const activeSpeechCancellations = new Set<() => void>();
const SPEECH_PLAYBACK_TIMEOUT_MS = 2 * 60_000;
let speechPlaybackTail: Promise<void> = Promise.resolve();
let speechPlaybackEpoch = 0;
let speechPlaybackMuted = false;
let speechPlaybackVolume: number | null = null;

// While the user records their voice, spoken audio would talk over them and leak into the microphone.
// Recorders take a hold: speech that is playing pauses, queued speech waits, and both carry on when the
// last hold is released. Muting or disabling speech still cancels everything, held or not.
let speechPlaybackHolds = 0;
const heldPlaybacks = new Set<{ suspend(): void; resume(): void }>();
let holdReleased: Array<() => void> = [];
const RESUME_REWIND_SECONDS = 0.6;

export function holdSpeechPlayback(): () => void {
  let released = false;
  speechPlaybackHolds += 1;
  if (speechPlaybackHolds === 1) for (const playback of heldPlaybacks) playback.suspend();
  return () => {
    if (released) return;
    released = true;
    speechPlaybackHolds -= 1;
    if (speechPlaybackHolds > 0) return;
    for (const playback of heldPlaybacks) playback.resume();
    const waiting = holdReleased;
    holdReleased = [];
    for (const resolve of waiting) resolve();
  };
}

function untilSpeechPlaybackReleased(): Promise<void> {
  return speechPlaybackHolds > 0 ? new Promise((resolve) => { holdReleased.push(resolve); }) : Promise.resolve();
}

// The user's mute choice on its own, without "speech is disabled": Companion shows it as a speaker
// button and silences its Live voice with it.
let speechMuted = false;
const speechMutedListeners = new Set<() => void>();
export function getSpeechMuted(): boolean { return speechMuted; }
export function subscribeSpeechMuted(listener: () => void): () => void {
  speechMutedListeners.add(listener);
  return () => { speechMutedListeners.delete(listener); };
}

export function applySpeechPlaybackSettings(input: {
  enabled: boolean;
  muted: boolean;
  volume: number;
}): void {
  if (speechMuted !== Boolean(input.muted)) {
    speechMuted = Boolean(input.muted);
    for (const listener of [...speechMutedListeners]) listener();
  }
  const volume = Number(input.volume);
  speechPlaybackVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  for (const audio of activeSpeechAudio) audio.volume = speechPlaybackVolume;

  speechPlaybackMuted = !input.enabled || input.muted;
  if (!speechPlaybackMuted) return;
  speechPlaybackEpoch += 1;
  for (const cancel of [...activeSpeechCancellations]) cancel();
}

export function enqueueBase64SpeechAudio(input: {
  data: string;
  mimeType?: string;
  volume?: number;
}): Promise<void> {
  const epoch = speechPlaybackEpoch;
  const playback = speechPlaybackTail.then(async () => {
    await untilSpeechPlaybackReleased();
    if (speechPlaybackMuted || epoch !== speechPlaybackEpoch) return;
    return playBase64SpeechAudio({
      ...input,
      volume: speechPlaybackVolume ?? input.volume,
    });
  });
  speechPlaybackTail = playback.catch(() => {});
  return playback;
}

export async function playBase64SpeechAudio(input: {
  data: string;
  mimeType?: string;
  volume?: number;
}): Promise<void> {
  const data = String(input.data ?? '').trim();
  if (!data) throw new Error('Speech audio is empty.');

  const mimeType = String(input.mimeType ?? '').trim() || 'audio/wav';
  if (mimeType !== 'audio/wav') throw new Error(`Unsupported speech audio type: ${mimeType}.`);

  let bytes: ArrayBuffer;
  try {
    const decoded = window.atob(data);
    bytes = new ArrayBuffer(decoded.length);
    const view = new Uint8Array(bytes);
    for (let index = 0; index < decoded.length; index += 1) {
      view[index] = decoded.charCodeAt(index);
    }
  } catch {
    throw new Error('Speech audio could not be decoded.');
  }

  const objectUrl = window.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  let audio: HTMLAudioElement;
  try {
    audio = new window.Audio(objectUrl);
  } catch (error) {
    window.URL.revokeObjectURL(objectUrl);
    throw error;
  }
  const volume = Number(input.volume);
  audio.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  activeSpeechAudio.add(audio);
  await new Promise<void>((resolve, reject) => {
    let cleanedUp = false;
    const cancel = () => {
      try {
        audio.pause();
      } catch {
        // Continue cleanup if the media element cannot be paused.
      }
      cleanup();
      resolve();
    };
    const startTimeout = () => setTimeout(() => {
      try {
        audio.pause();
      } catch {
        // Continue cleanup if the media element cannot be paused.
      }
      cleanup();
      reject(new Error('Speech audio playback timed out.'));
    }, SPEECH_PLAYBACK_TIMEOUT_MS);
    let timeout = startTimeout();
    // A recording may outlast the timeout; time spent held does not count as playback.
    const held = {
      suspend() {
        clearTimeout(timeout);
        try { audio.pause(); } catch { /* It resumes or is cancelled either way. */ }
      },
      resume() {
        if (cleanedUp) return;
        timeout = startTimeout();
        // Pick the sentence up just before where it was cut off.
        try { audio.currentTime = Math.max(0, (audio.currentTime || 0) - RESUME_REWIND_SECONDS); } catch { /* Not seekable. */ }
        void audio.play().catch((error) => { cleanup(); reject(error); });
      },
    };
    heldPlaybacks.add(held);
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      heldPlaybacks.delete(held);
      activeSpeechAudio.delete(audio);
      activeSpeechCancellations.delete(cancel);
      window.URL.revokeObjectURL(objectUrl);
    };
    activeSpeechCancellations.add(cancel);
    audio.addEventListener(
      'ended',
      () => {
        cleanup();
        resolve();
      },
      { once: true },
    );
    audio.addEventListener(
      'error',
      () => {
        cleanup();
        reject(new Error('Speech audio playback failed.'));
      },
      { once: true },
    );
    try {
      // A recording that began while this clip was being prepared keeps it silent from the start.
      if (speechPlaybackHolds > 0) held.suspend();
      else void audio.play().catch((error) => {
        cleanup();
        reject(error);
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
