import { describe, expect, mock, test } from 'bun:test';

mock.module('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: { cache: '', document: '' } }));
const { MobileSpeechClipQueue, mobileAudioMimeType, uploadMobileSpeechClip } = await import('../src/local-assistant/mobile-speech-clips');
type Queued = import('../src/local-assistant/mobile-speech-clips').QueuedSpeechClip;

function memoryStorage() {
  const entries = new Map<string, Queued>();
  return {
    entries,
    adopt(uri: string, entry: Omit<Queued, 'audioUri'>) {
      const queued = { ...entry, audioUri: uri };
      entries.set(entry.id, queued);
      return queued;
    },
    list: () => [...entries.values()].map((entry) => ({ ...entry })).sort((a, b) => a.createdAt - b.createdAt),
    save: (entry: Queued) => { entries.set(entry.id, { ...entry }); },
    remove: (entry: Queued) => { entries.delete(entry.id); },
    size: () => 10,
  };
}

describe('mobile speech clip queue', () => {
  test('keeps recordings while the Hub is unreachable and uploads them on reconnect', async () => {
    const storage = memoryStorage();
    let clock = 1_000;
    const queue = new MobileSpeechClipQueue(storage, () => clock++);
    const offline = { deviceId: 'desk', upload: async () => { throw new Error('TARGET_DEVICE_OFFLINE'); } };
    queue.setSink(offline);
    queue.enqueue('file:///a.m4a', 'audio/mp4', { status: 'transcribed', surface: 'mobile-dictation', text: 'one' });
    queue.enqueue('file:///b.m4a', 'audio/mp4', { status: 'canceled', surface: 'mobile-dictation' });
    for (let i = 0; i < 30; i += 1) await queue.drain();
    expect(storage.entries.size).toBe(2);
    expect([...storage.entries.values()].every((entry) => entry.attempts === 0)).toBe(true);

    const uploaded: string[] = [];
    queue.setSink({ deviceId: 'desk', upload: async (clip) => { uploaded.push(clip.uri); } });
    await queue.drain();
    expect(uploaded).toEqual(['file:///a.m4a', 'file:///b.m4a']);
    expect(storage.entries.size).toBe(0);
  });

  test('only uploads to the Hub the recording was made for', async () => {
    const storage = memoryStorage();
    const queue = new MobileSpeechClipQueue(storage);
    queue.setSink({ deviceId: 'laptop', upload: async () => { throw new Error('offline'); } });
    queue.enqueue('file:///a.m4a', 'audio/mp4', { status: 'transcribed', surface: 'mobile-dictation' });
    await queue.drain();
    const uploaded: string[] = [];
    queue.setSink({ deviceId: 'studio', upload: async (clip) => { uploaded.push(clip.uri); } });
    await queue.drain();
    expect(uploaded).toEqual([]);
    expect(storage.entries.size).toBe(1);
  });

  test('drops a recording the Hub keeps rejecting, without blocking the next one', async () => {
    const storage = memoryStorage();
    let clock = 1_000;
    const queue = new MobileSpeechClipQueue(storage, () => clock++);
    const uploaded: string[] = [];
    queue.setSink({
      deviceId: 'desk',
      upload: async (clip) => {
        if (clip.uri.endsWith('bad.m4a')) throw Object.assign(new Error('nope'), { code: 'INVALID_REQUEST' });
        uploaded.push(clip.uri);
      },
    });
    queue.enqueue('file:///bad.m4a', 'audio/mp4', { status: 'failed', surface: 'mobile-dictation' });
    queue.enqueue('file:///good.m4a', 'audio/mp4', { status: 'transcribed', surface: 'mobile-dictation' });
    for (let i = 0; i < 10; i += 1) await queue.drain();
    expect(uploaded).toEqual(['file:///good.m4a']);
    expect(storage.entries.size).toBe(0);
  });

  test('forgets recordings older than a week', async () => {
    const storage = memoryStorage();
    let clock = 0;
    const queue = new MobileSpeechClipQueue(storage, () => clock);
    queue.setSink({ deviceId: 'desk', upload: async () => { throw new Error('offline'); } });
    queue.enqueue('file:///old.m4a', 'audio/mp4', { status: 'transcribed', surface: 'mobile-dictation' });
    await queue.drain();
    clock = 8 * 24 * 60 * 60_000;
    await queue.drain();
    expect(storage.entries.size).toBe(0);
  });
});

const clip = {
  uri: 'file:///cache/recording-1.m4a',
  size: 12,
  mimeType: 'audio/mp4',
  status: 'transcribed' as const,
  surface: 'mobile-dictation',
  text: 'remember the milk',
};

describe('mobile speech clip upload', () => {
  test('prepares, uploads the file, then commits its outcome', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const uploads: Array<[string, string, Record<string, string>]> = [];
    await uploadMobileSpeechClip(
      clip,
      async (operation, payload) => {
        calls.push([operation, payload]);
        return operation === 'speech-clips.prepare' ? { uploadId: 'u1', uploadUrl: 'https://hub/put', uploadToken: 'secret' } : {};
      },
      async (url, uri, headers) => { uploads.push([url, uri, headers]); },
    );
    expect(calls).toEqual([
      ['speech-clips.prepare', { size: 12 }],
      ['speech-clips.commit', { uploadId: 'u1', status: 'transcribed', surface: 'mobile-dictation', mimeType: 'audio/mp4', text: 'remember the milk' }],
    ]);
    expect(uploads).toEqual([[
      'https://hub/put',
      clip.uri,
      { authorization: 'Bearer secret', 'x-upload-offset': '0', 'content-type': 'application/octet-stream' },
    ]]);
  });

  test('aborts the staged upload when the transfer fails', async () => {
    const operations: string[] = [];
    await expect(uploadMobileSpeechClip(
      clip,
      async (operation) => {
        operations.push(operation);
        return { uploadId: 'u1', uploadUrl: 'https://hub/put', uploadToken: 'secret' };
      },
      async () => { throw new Error('HTTP upload failed (500)'); },
    )).rejects.toThrow('HTTP upload failed');
    expect(operations).toEqual(['speech-clips.prepare', 'speech-clips.abort']);
  });

  test('derives the audio type from the recording file name', () => {
    expect(mobileAudioMimeType('file:///a/b.wav')).toBe('audio/wav');
    expect(mobileAudioMimeType('file:///a/b.m4a')).toBe('audio/mp4');
    expect(mobileAudioMimeType('file:///a/b.3gp')).toBe('audio/3gpp');
  });
});
