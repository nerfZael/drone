import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpeechClipStore } from '../src/hub/speech-clips/SpeechClipStore';
import { SpeechClipService } from '../src/hub/speech-clips/registerSpeechClipRoutes';
import { createCompanionNote } from '../src/hub/companion/companion-notes';
import { MeshSpeechClipUploads } from '../src/hub/device-mesh/mesh-speech-clip-uploads';

const roots: string[] = [];
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-clips-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function wav(seconds: number): Buffer {
  const data = Buffer.alloc(16_000 * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.write('WAVE', 8, 'ascii');
  header.writeUInt32LE(32_000, 28);
  return Buffer.concat([header, data]);
}

describe('speech clip store', () => {
  test('keeps audio with its outcome and lists newest first', async () => {
    const store = new SpeechClipStore(await tempRoot());
    const first = await store.create({ audio: wav(2), mimeType: 'audio/wav', status: 'transcribing', surface: 'global-dictation' });
    await Bun.sleep(5); // Clips are ordered by creation time.
    const second = await store.create({ audio: Buffer.from('webm'), mimeType: 'audio/webm;codecs=opus', status: 'canceled', surface: 'voice-message', target: 'Fix login' });
    expect(first.durationMs).toBe(2000);
    expect(second.mimeType).toBe('audio/webm');
    expect(second.durationMs).toBeNull();

    const done = await store.update(first.id, { status: 'transcribed', text: 'hello there', model: 'whisper' });
    expect(done.transcribedAt).not.toBeNull();
    expect((await store.list()).map((clip) => clip.id)).toEqual([second.id, first.id]);
    const audio = await store.audio(first.id);
    expect(path.basename(audio.file)).toBe('audio.wav');
    expect(audio.size).toBe(wav(2).length);

    await store.remove(second.id);
    expect((await store.list()).map((clip) => clip.id)).toEqual([first.id]);
  });

  test('reports a transcription abandoned by a stopped Hub as failed', async () => {
    const root = await tempRoot();
    const store = new SpeechClipStore(root);
    const clip = await store.create({ audio: wav(1), mimeType: 'audio/wav', status: 'transcribing' });
    const file = path.join(root, clip.id, 'clip.json');
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    stored.updatedAt = new Date(Date.now() - 11 * 60_000).toISOString();
    await fs.writeFile(file, JSON.stringify(stored));
    expect((await store.read(clip.id)).status).toBe('failed');
  });

  test('leaves nothing behind when a clip cannot be saved', async () => {
    const root = await tempRoot();
    const store = new SpeechClipStore(root);
    (store as any).save = async () => { throw new Error('disk full'); };
    await expect(store.create({ audio: wav(1), mimeType: 'audio/wav', status: 'canceled' })).rejects.toThrow('disk full');
    expect(await fs.readdir(root)).toEqual([]);
    expect((await store.summary()).bytes).toBe(0);
  });

  test('rejects path-like IDs', async () => {
    const store = new SpeechClipStore(await tempRoot());
    await expect(store.read('../../etc')).rejects.toThrow('Invalid speech clip ID.');
  });
});

describe('speech clip service', () => {
  test('records a transcription and can transcribe the saved audio again', async () => {
    const store = new SpeechClipStore(await tempRoot());
    const calls: string[] = [];
    const service = new SpeechClipService(store, async (_audio, mimeType) => {
      calls.push(mimeType);
      return { text: 'second try', model: 'whisper-large-v3' };
    }, () => undefined);
    const id = await service.begin({ audio: wav(1), mimeType: 'audio/wav', surface: 'companion' });
    await expect(service.retranscribe(id!)).rejects.toThrow('already being transcribed');
    await service.finish(id, { error: 'GROQ failed' });
    expect((await store.read(id!)).status).toBe('failed');

    const retried = await service.retranscribe(id!);
    expect(calls).toEqual(['audio/wav']);
    expect(retried).toMatchObject({ status: 'transcribed', text: 'second try', error: null });
  });

  test('never fails the transcription when the clip cannot be saved', async () => {
    const logs: string[] = [];
    const service = new SpeechClipService(new SpeechClipStore(await tempRoot()), async () => ({ text: '', model: '' }), (_level, message) => logs.push(message));
    expect(await service.begin({ audio: Buffer.alloc(0) })).toBeNull();
    await service.finish(null, { text: 'ignored', model: 'x' });
    expect(logs).toEqual(['speech clip could not be saved']);
  });
});

describe('companion notes', () => {
  const now = () => new Date(2026, 9, 9, 14, 30);

  test('names the file from the suggested title and the date', async () => {
    const homeRoot = await tempRoot();
    const note = await createCompanionNote('  buy milk and eggs  ', { homeRoot, now, suggestTitle: async () => 'Grocery: list?' });
    expect(note).toEqual({ path: 'notes/2026-10-09 Grocery list.md', name: '2026-10-09 Grocery list.md', title: 'Grocery list' });
    expect(await fs.readFile(path.join(homeRoot, note.path), 'utf8')).toBe('buy milk and eggs\n');

    const again = await createCompanionNote('bread', { homeRoot, now, suggestTitle: async () => 'Grocery list' });
    expect(again.name).toBe('2026-10-09 Grocery list (2).md');
  });

  test('falls back to the opening words when naming fails', async () => {
    const homeRoot = await tempRoot();
    const warnings: string[] = [];
    const note = await createCompanionNote('Call the dentist about moving the appointment to Friday', {
      homeRoot,
      now,
      suggestTitle: async () => { throw new Error('no key'); },
      log: (_level, message) => warnings.push(message),
    });
    expect(note.name).toBe('2026-10-09 Call the dentist about moving the.md');
    expect(warnings).toHaveLength(1);
  });

  test('does not wait on a hanging naming provider', async () => {
    const note = await createCompanionNote('Plan the offsite agenda', {
      homeRoot: await tempRoot(),
      now,
      titleTimeoutMs: 20,
      suggestTitle: () => new Promise<string>(() => undefined),
    });
    expect(note.title).toBe('Plan the offsite agenda');
  });

  test('rejects empty text', async () => {
    await expect(createCompanionNote('   ', { homeRoot: await tempRoot(), suggestTitle: async () => 'x' })).rejects.toThrow('Note text is required.');
  });
});

describe('mesh speech clip uploads', () => {
  test('stages a phone upload and files it under the phone name', async () => {
    const root = await tempRoot();
    const tickets: Array<{ resolve(): Promise<string>; completed?(): void; authorized(): Promise<boolean> }> = [];
    const recorded: any[] = [];
    const uploads = new MeshSpeechClipUploads(root, {
      issue: (ticket: any) => { tickets.push(ticket); return { url: 'https://hub/upload', token: 'token', size: ticket.size, expiresAt: '' }; },
    }, async (input) => { recorded.push(input); return { id: 'clip-1' }; });
    try {
      const prepared = await uploads.prepare('phone', { size: 4 });
      expect(prepared).toMatchObject({ uploadUrl: 'https://hub/upload', uploadToken: 'token' });
      await expect(uploads.commit('phone', 'Pixel', { uploadId: prepared.uploadId, status: 'transcribed' })).rejects.toThrow('incomplete');

      const second = await uploads.prepare('phone', { size: 4 });
      await expect(uploads.commit('laptop', 'Laptop', { uploadId: second.uploadId, status: 'transcribed' })).rejects.toThrow('not found');
      await fs.writeFile(await tickets[1]!.resolve(), 'abcd');
      tickets[1]!.completed?.();
      expect(await uploads.commit('phone', 'Pixel', {
        uploadId: second.uploadId, status: 'transcribed', text: 'hi', surface: 'mobile-dictation', mimeType: 'audio/mp4',
      })).toEqual({ clipId: 'clip-1' });
      expect(recorded[0]).toMatchObject({ sourceDevice: 'Pixel', status: 'transcribed', text: 'hi', mimeType: 'audio/mp4' });
      expect(recorded[0].audio.toString()).toBe('abcd');
      expect(await tickets[1]!.authorized()).toBe(false);
      expect(await fs.readdir(root)).toEqual([]);
    } finally { uploads.close(); }
  });

  test('rejects oversized clips', async () => {
    const uploads = new MeshSpeechClipUploads(await tempRoot(), { issue: () => ({ url: 'u', token: 't', size: 1, expiresAt: '' }) }, async () => ({ id: 'x' }));
    try {
      await expect(uploads.prepare('phone', { size: 26 * 1024 * 1024 })).rejects.toThrow('speech clip size');
    } finally { uploads.close(); }
  });
});

describe('speech clip routes', () => {
  test('file a canceled clip, play it, transcribe it, and delete it over HTTP', async () => {
    const http = await import('node:http');
    const { HubRouter } = await import('../src/hub/hub-router');
    const { readJsonBody } = await import('../src/hub/hub-http');
    const { registerSpeechClipRoutes } = await import('../src/hub/speech-clips/registerSpeechClipRoutes');
    const store = new SpeechClipStore(await tempRoot());
    const service = new SpeechClipService(store, async () => ({ text: 'transcribed later', model: 'whisper-large-v3' }), () => undefined);
    const router = new HubRouter((res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    }, readJsonBody);
    registerSpeechClipRoutes(router, service);
    const server = http.createServer((req, res) => {
      void router.handle(req, res, new URL(req.url ?? '/', 'http://localhost')).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const audio = wav(1);
      const filed = await fetch(`${base}/api/speech-clips?status=canceled`, {
        method: 'POST',
        headers: {
          'content-type': 'audio/wav',
          'x-drone-speech-surface': 'global-dictation',
          'x-drone-speech-target': encodeURIComponent('Fix login · default'),
          'x-drone-remote-device': encodeURIComponent('Studio Mac'),
        },
        body: audio,
      });
      expect(filed.status).toBe(200);
      const { clip } = await filed.json() as any;
      expect(clip).toMatchObject({ status: 'canceled', surface: 'global-dictation', target: 'Fix login · default', sourceDevice: 'Studio Mac' });

      expect((await fetch(`${base}/api/speech-clips?status=transcribed`, { method: 'POST', body: audio })).status).toBe(400);

      const played = await fetch(`${base}/api/speech-clips/${clip.id}/audio`);
      expect(played.headers.get('content-type')).toBe('audio/wav');
      expect(Buffer.from(await played.arrayBuffer()).equals(audio)).toBe(true);
      const ranged = await fetch(`${base}/api/speech-clips/${clip.id}/audio`, { headers: { range: 'bytes=4-11' } });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('content-range')).toBe(`bytes 4-11/${audio.length}`);
      expect(Buffer.from(await ranged.arrayBuffer()).equals(audio.subarray(4, 12))).toBe(true);
      expect((await fetch(`${base}/api/speech-clips/${clip.id}/audio`, { headers: { range: `bytes=${audio.length}-` } })).status).toBe(416);

      await Bun.sleep(5);
      await store.create({ audio: wav(1), mimeType: 'audio/wav', status: 'failed', error: 'x' });
      const page = await (await fetch(`${base}/api/speech-clips?status=canceled&limit=1`)).json() as any;
      expect(page).toMatchObject({ total: 2, matching: 1 });
      expect(page.clips.map((item: any) => item.id)).toEqual([clip.id]);
      const newest = await (await fetch(`${base}/api/speech-clips?limit=1`)).json() as any;
      expect(newest.clips).toHaveLength(1);
      expect(newest.clips[0].status).toBe('failed');
      await store.remove(newest.clips[0].id);

      const retried = await (await fetch(`${base}/api/speech-clips/${clip.id}/retranscribe`, { method: 'POST' })).json() as any;
      expect(retried.clip).toMatchObject({ status: 'transcribed', text: 'transcribed later' });
      const listed = (await (await fetch(`${base}/api/speech-clips`)).json()) as any;
      expect(listed.clips).toHaveLength(1);
      // Audio plus its metadata file.
      expect(listed.totalBytes).toBeGreaterThan(audio.length);

      expect((await fetch(`${base}/api/speech-clips/${clip.id}`, { method: 'DELETE' })).status).toBe(200);
      expect(((await (await fetch(`${base}/api/speech-clips`)).json()) as any)).toMatchObject({ clips: [], totalBytes: 0 });
      expect((await fetch(`${base}/api/speech-clips/${clip.id}/audio`)).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('transcription endpoint', () => {
  test('keeps the recording when no GROQ key is configured', async () => {
    const http = await import('node:http');
    const { HubRouter } = await import('../src/hub/hub-router');
    const { readJsonBody } = await import('../src/hub/hub-http');
    const { registerOperationalRoutes } = await import('../src/hub/routes/operational-routes');
    const store = new SpeechClipStore(await tempRoot());
    const service = new SpeechClipService(store, async () => ({ text: 'later', model: 'm' }), () => undefined);
    const router = new HubRouter((res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    }, readJsonBody);
    const unused = async () => { throw new Error('unused'); };
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: unused,
      readChatIdleStatus: unused,
      resolveGroqApiKeySettings: async () => ({ apiKey: null }),
      resolveSpeechSettings: unused,
      emitAssistantUiAction: unused,
      hubLog: () => undefined,
      speechClips: service,
    });
    const server = http.createServer((req, res) => {
      void router.handle(req, res, new URL(req.url ?? '/', 'http://localhost'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/audio/transcriptions`, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav', 'x-drone-speech-surface': 'global-dictation' },
        body: wav(1),
      });
      expect(response.status).toBe(400);
      let clips = await store.list();
      for (let tries = 0; clips[0]?.status !== 'failed' && tries < 50; tries += 1) {
        await Bun.sleep(10);
        clips = await store.list();
      }
      expect(clips).toHaveLength(1);
      expect(clips[0]).toMatchObject({ status: 'failed', surface: 'global-dictation', error: expect.stringContaining('GROQ API key') });
      expect((await service.retranscribe(clips[0]!.id)).status).toBe('transcribed');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
