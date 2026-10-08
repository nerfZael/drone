import { Directory, File, Paths } from 'expo-file-system';

export type MobileSpeechClipStatus = 'transcribed' | 'failed' | 'canceled';

export type MobileSpeechClipMetadata = {
  status: MobileSpeechClipStatus;
  surface: string;
  text?: string;
  error?: string;
  model?: string;
};

export type MobileSpeechClipUpload = MobileSpeechClipMetadata & { uri: string; size: number; mimeType: string };

/** Files recordings with one desktop Hub. Installed by the screen that knows which Hub is selected. */
export type MobileSpeechClipSink = {
  deviceId: string;
  upload(clip: MobileSpeechClipUpload): Promise<void>;
};

/** One recording waiting for its desktop Hub. */
export type QueuedSpeechClip = {
  id: string;
  deviceId: string;
  createdAt: number;
  attempts: number;
  audioUri: string;
  mimeType: string;
  metadata: MobileSpeechClipMetadata;
};

/** Where queued recordings live: app documents in the app, memory in tests. */
export type SpeechClipQueueStorage = {
  /** Moves the recording into the queue and records it. */
  adopt(uri: string, entry: Omit<QueuedSpeechClip, 'audioUri'>): QueuedSpeechClip;
  list(): QueuedSpeechClip[];
  save(entry: QueuedSpeechClip): void;
  remove(entry: QueuedSpeechClip): void;
  /** Size in bytes, or null when the audio is gone. */
  size(entry: QueuedSpeechClip): number | null;
};

/**
 * Gives up on a clip the Hub keeps rejecting, e.g. one too old to accept phone recordings.
 * Only answers from the Hub count: being unreachable never uses up attempts.
 */
export const SPEECH_CLIP_MAX_ATTEMPTS = 5;
const REJECTION_CODES = new Set(['UNSUPPORTED_OPERATION', 'INVALID_REQUEST', 'PERMISSION_DENIED']);
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_QUEUED = 100;
const RETRY_MS = 60_000;

/**
 * Keeps phone recordings until the desktop Hub they were dictated to accepts them.
 * Uploads run one at a time; the first failure (usually: Hub unreachable) ends the pass,
 * and the next filing, reconnect, or minute-long retry tries again.
 */
export class MobileSpeechClipQueue {
  private sink: MobileSpeechClipSink | null = null;
  private draining: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly storage: SpeechClipQueueStorage,
    private readonly now: () => number = Date.now,
  ) {}

  get deviceId(): string | null {
    return this.sink?.deviceId ?? null;
  }

  setSink(sink: MobileSpeechClipSink | null): void {
    this.sink = sink;
    if (sink) void this.drain();
  }

  enqueue(uri: string, mimeType: string, metadata: MobileSpeechClipMetadata): void {
    const deviceId = this.sink?.deviceId;
    if (!deviceId) throw new Error('No desktop Hub is selected.');
    const createdAt = this.now();
    this.storage.adopt(uri, {
      id: `${createdAt}-${Math.random().toString(36).slice(2, 10)}`,
      deviceId,
      createdAt,
      attempts: 0,
      mimeType,
      metadata,
    });
    void this.drain();
  }

  drain(): Promise<void> {
    if (this.draining) {
      this.again = true;
      return this.draining;
    }
    this.draining = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })().finally(() => { this.draining = null; });
    return this.draining;
  }

  private async pass(): Promise<void> {
    for (const entry of this.prune()) {
      const sink = this.sink;
      if (!sink) return;
      if (entry.deviceId !== sink.deviceId) continue;
      const size = this.storage.size(entry);
      if (!size) { this.storage.remove(entry); continue; }
      try {
        await sink.upload({ ...entry.metadata, uri: entry.audioUri, size, mimeType: entry.mimeType });
        this.storage.remove(entry);
      } catch (error) {
        if (REJECTION_CODES.has(String((error as { code?: unknown })?.code ?? ''))) {
          entry.attempts += 1;
          if (entry.attempts >= SPEECH_CLIP_MAX_ATTEMPTS) {
            this.storage.remove(entry);
            continue;
          }
          this.storage.save(entry);
        }
        return;
      }
    }
  }

  /** Drops clips over a week old and the oldest beyond the cap; returns the rest, oldest first. */
  private prune(): QueuedSpeechClip[] {
    const entries = this.storage.list();
    const now = this.now();
    return entries.filter((entry, index) => {
      if (now - entry.createdAt <= MAX_AGE_MS && index >= entries.length - MAX_QUEUED) return true;
      this.storage.remove(entry);
      return false;
    });
  }
}

/** Queue files in app documents (not the cache), so they survive restarts and cache eviction. */
export function documentSpeechClipStorage(): SpeechClipQueueStorage {
  const directory = new Directory(Paths.document, 'speech-clip-queue');
  const metadataFile = (id: string) => new File(directory, `${id}.json`);
  const write = (entry: QueuedSpeechClip) => {
    const file = metadataFile(entry.id);
    file.create({ overwrite: true });
    file.write(JSON.stringify(entry));
  };
  return {
    adopt(uri, entry) {
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      const extension = uri.split('?')[0]!.split('.').pop()?.toLowerCase() || 'm4a';
      const audio = new File(directory, `${entry.id}.${extension}`);
      new File(uri).moveSync(audio);
      const queued = { ...entry, audioUri: audio.uri };
      write(queued);
      return queued;
    },
    list() {
      if (!directory.exists) return [];
      const entries: QueuedSpeechClip[] = [];
      for (const item of directory.list()) {
        if (!(item instanceof File) || !item.name.endsWith('.json')) continue;
        try { entries.push(JSON.parse(item.textSync())); }
        catch { try { item.delete(); } catch { /* best-effort */ } }
      }
      return entries.sort((a, b) => a.createdAt - b.createdAt);
    },
    save: write,
    remove(entry) {
      for (const file of [new File(entry.audioUri), metadataFile(entry.id)]) {
        try { if (file.exists) file.delete(); } catch { /* best-effort */ }
      }
    },
    size(entry) {
      try {
        const file = new File(entry.audioUri);
        return file.exists ? file.size || null : null;
      } catch { return null; }
    },
  };
}

let queue: MobileSpeechClipQueue | null = null;
function sharedQueue(): MobileSpeechClipQueue {
  queue ??= new MobileSpeechClipQueue(documentSpeechClipStorage());
  return queue;
}
let retryTimer: ReturnType<typeof setInterval> | null = null;
const filedUris = new Set<string>();

/** Selecting a desktop Hub also retries whatever is still queued for it. */
export function setMobileSpeechClipSink(sink: MobileSpeechClipSink | null): () => void {
  try { sharedQueue().setSink(sink); } catch { /* storage unavailable: recordings are just deleted */ }
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = sink ? setInterval(() => void queue?.drain(), RETRY_MS) : null;
  return () => {
    if (!sink || queue?.deviceId !== sink.deviceId) return;
    queue.setSink(null);
    if (retryTimer) clearInterval(retryTimer);
    retryTimer = null;
  };
}

function deleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache eviction remains a fallback.
  }
}

/**
 * Keeps a finished recording for the selected desktop Hub, uploading it now or once that Hub
 * is reachable. Each file is filed once: a discard racing its own transcription keeps the
 * first outcome. Without a desktop Hub (phone-local drones) the file is simply deleted.
 */
export function fileMobileSpeechClip(uri: string | null | undefined, metadata: MobileSpeechClipMetadata): void {
  if (!uri || filedUris.has(uri)) return;
  filedUris.add(uri);
  try {
    if (sharedQueue().deviceId && new File(uri).exists) {
      sharedQueue().enqueue(uri, mobileAudioMimeType(uri), metadata);
      return;
    }
  } catch {
    // Keeping recordings is best-effort; it must never disturb dictation.
  } finally {
    filedUris.delete(uri);
  }
  deleteFile(uri);
}

/** Continuous voice holds segments in memory; stage one as a WAV file to file it. */
export function fileMobileSpeechWave(wave: Uint8Array, metadata: MobileSpeechClipMetadata): void {
  if (!queue?.deviceId || wave.length <= 44) return;
  const file = new File(Paths.cache, `speech-clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.wav`);
  try {
    file.create({ overwrite: true });
    file.write(wave);
  } catch {
    deleteFile(file.uri);
    return;
  }
  fileMobileSpeechClip(file.uri, metadata);
}

export function mobileAudioMimeType(uri: string): string {
  const extension = uri.split('?')[0]!.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'wav') return 'audio/wav';
  if (extension === '3gp') return 'audio/3gpp';
  if (extension === 'webm') return 'audio/webm';
  if (extension === 'caf') return 'audio/x-caf';
  if (extension === 'aac') return 'audio/aac';
  return 'audio/mp4';
}

type MeshCall = (operation: string, payload: Record<string, unknown>) => Promise<any>;
type UploadFile = (url: string, uri: string, headers: Record<string, string>) => Promise<unknown>;

/** prepare → PUT the file → commit, aborting the staged upload on failure. */
export async function uploadMobileSpeechClip(
  clip: MobileSpeechClipUpload & { target?: string },
  call: MeshCall,
  uploadFile: UploadFile,
): Promise<void> {
  const prepared = await call('speech-clips.prepare', { size: clip.size });
  const uploadId = String(prepared?.uploadId ?? '');
  if (!uploadId || !prepared?.uploadUrl || !prepared?.uploadToken) {
    throw new Error('The Hub did not authorize the recording upload.');
  }
  try {
    await uploadFile(String(prepared.uploadUrl), clip.uri, {
      authorization: `Bearer ${prepared.uploadToken}`,
      'x-upload-offset': '0',
      'content-type': 'application/octet-stream',
    });
    await call('speech-clips.commit', {
      uploadId,
      status: clip.status,
      surface: clip.surface,
      mimeType: clip.mimeType,
      ...(clip.target ? { target: clip.target } : {}),
      ...(clip.text ? { text: clip.text } : {}),
      ...(clip.error ? { error: clip.error } : {}),
      ...(clip.model ? { model: clip.model } : {}),
    });
  } catch (error) {
    await call('speech-clips.abort', { uploadId }).catch(() => undefined);
    throw error;
  }
}
