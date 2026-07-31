const activeSpeechAudio = new Set<HTMLAudioElement>();
const activeSpeechCancellations = new Set<() => void>();
const SPEECH_PLAYBACK_TIMEOUT_MS = 2 * 60_000;
let speechPlaybackTail: Promise<void> = Promise.resolve();
let speechPlaybackEpoch = 0;
let speechPlaybackMuted = false;
let speechPlaybackVolume: number | null = null;

export function applySpeechPlaybackSettings(input: {
  enabled: boolean;
  muted: boolean;
  volume: number;
}): void {
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
  const playback = speechPlaybackTail.then(() => {
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
    const timeout = setTimeout(() => {
      try {
        audio.pause();
      } catch {
        // Continue cleanup if the media element cannot be paused.
      }
      cleanup();
      reject(new Error('Speech audio playback timed out.'));
    }, SPEECH_PLAYBACK_TIMEOUT_MS);
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
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
      void audio.play().catch((error) => {
        cleanup();
        reject(error);
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
