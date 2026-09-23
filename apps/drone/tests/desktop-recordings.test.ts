import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { RecordingStore, recordingMarkdown } from '../src/hub/recordings/RecordingStore';
import { RecordingProcessor } from '../src/hub/recordings/RecordingProcessor';
import { mergeRecordingSegments } from '../src/hub/recordings/recording-audio';
import { protectCompanionTranscripts } from '../src/hub/companion/protectCompanionTranscripts';
import { captureArgs } from '../desktop/hub-desktop-recordings.cjs';

let root: string;
let store: RecordingStore;
const originalFetch = globalThis.fetch;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-recording-test-')); store = new RecordingStore(path.join(root, 'home'), path.join(root, 'pending')); });
afterEach(async () => { globalThis.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); });

describe('recording bundles', () => {
  test('publishes in existing home, preserves identity on rename, and keeps overlap', async () => {
    const { recording } = await store.create({ title: 'Planning', keepAudio: true });
    expect(await fs.stat(path.join(root, 'home')).catch(() => null)).toBeNull();
    recording.segments = mergeRecordingSegments(
      [{ source: 'microphone', speakerId: 'you', start: 3, end: 5, text: 'ship it' }],
      [{ source: 'system', speakerId: 'speaker-1', start: 2, end: 4, text: 'agree' }],
    );
    recording.status = 'complete';
    const directory = await store.publish(recording.id);
    await store.save(recording);
    await store.rename(recording.id, 'Renamed');
    expect(await store.directory(recording.id)).toBe(directory);
    expect(directory).toContain(path.join('home', 'transcripts', recording.id.slice(0, 4), recording.id.slice(5, 7)));
    expect((await store.read(recording.id)).title).toBe('Renamed');
    const markdown = recordingMarkdown(recording);
    expect(markdown).toContain('**You:** ship it');
    expect(markdown).toContain('**Speaker 1:** agree');
    expect(recording.segments).toHaveLength(2);
    expect((await store.list()).map(item => item.id)).toEqual([recording.id]);
    await store.remove(recording.id);
    expect(await store.list()).toEqual([]);
  });

  test('rejects traversal and symlinked provider input', async () => {
    const { recording, directory } = await store.create({});
    await expect(store.read('../outside')).rejects.toThrow('Invalid recording ID');
    await fs.writeFile(path.join(root, 'secret'), 'private');
    await fs.symlink(path.join(root, 'secret'), path.join(directory, 'system.flac'));
    await expect(store.file(directory, 'system.flac')).rejects.toThrow('Invalid recording file');
    await expect(store.file(directory, '../../secret')).rejects.toThrow('Invalid recording file');
    expect((await store.read(recording.id)).segments).toEqual([]);
  });
});

describe('two-track processing with real FFmpeg and mocked providers', () => {
  test('resets timestamps on later chunks before sending them to GROQ', async () => {
    const { recording, directory } = await store.create({ liveTranscription: true });
    await fixtureAudio(directory);
    for (const source of ['microphone', 'system']) {
      const shifted = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
        '-af', 'asetpts=PTS+120/TB', '-ar', '16000', '-ac', '1', '-c:a', 'flac', path.join(directory, source, '000001.flac')]);
      expect(shifted.status).toBe(0);
      await fs.appendFile(path.join(directory, `${source}.csv`), '000001.flac,120.000000,132.000000\n');
    }
    recording.previewChunks = 1;
    globalThis.fetch = (async () => Response.json({ text: 'hello', segments: [{ start: 0, end: 0.5, text: 'hello' }] })) as typeof fetch;
    await new RecordingProcessor(store, async () => ({ microphone: 'test', system: 'test' })).preview(recording);
    for (const source of ['microphone', 'system']) {
      const normalized = path.join(directory, 'processing', `${source}-000001.flac.normalized.flac`);
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=start_time', '-of', 'default=noprint_wrappers=1:nokey=1', normalized], { encoding: 'utf8' });
      expect(probe.status).toBe(0);
      expect(Number(probe.stdout.trim())).toBe(0);
    }
  });

  test('identifies the track and audio time when transcription fails', async () => {
    const { recording, directory } = await store.create({ keepAudio: true });
    await fixtureAudio(directory);
    globalThis.fetch = (async () => Response.json({ error: { message: 'Internal Server Error' } }, { status: 500, statusText: 'Internal Server Error' })) as typeof fetch;
    await expect(new RecordingProcessor(store, async () => ({ microphone: 'test', system: 'test' })).process(recording))
      .rejects.toThrow(/Microphone transcription failed at 0:00–0:01: GROQ transcription failed \(HTTP 500 Internal Server Error\): The provider returned no further details\. Retry processing; the source audio is saved\./);
  });

  test('rebuilds interrupted caches and supports data directories containing quotes and newlines', async () => {
    store = new RecordingStore(path.join(root, "home's\nfiles"), path.join(root, "pending's\nfiles"));
    const { recording, directory } = await store.create({ keepAudio: true });
    await fixtureAudio(directory);
    await fs.mkdir(path.join(directory, 'processing'));
    await fs.writeFile(path.join(directory, 'processing/microphone-000000.flac.json'), '{}');
    await fs.writeFile(path.join(directory, 'processing/diarized-0.json'), '[{"start":');
    const requests: string[] = [];
    globalThis.fetch = (async url => {
      requests.push(String(url));
      return String(url).includes('groq') ? Response.json({ text: 'hello', segments: [{ start: 0, end: 0.5, text: 'hello' }] }) : Response.json({ segments: [] });
    }) as typeof fetch;
    await new RecordingProcessor(store, async () => ({ microphone: 'test', system: 'test' })).process(recording);
    expect((await store.read(recording.id)).status).toBe('complete');
    expect(requests).toHaveLength(2);
  });

  test('uses diarized JSON, preserves speaker overlap, and removes audio only after completion', async () => {
    const { recording, directory } = await store.create({ keepAudio: false });
    await fixtureAudio(directory);
    const requests: string[] = [];
    globalThis.fetch = (async (url, init) => {
      const form = init!.body as FormData;
      requests.push(String(form.get('model')));
      if (String(url).includes('groq')) {
        expect(form.get('response_format')).toBe('verbose_json');
        return Response.json({ text: 'hello', segments: [{ start: 0, end: 0.8, text: 'hello' }] });
      }
      expect(form.get('model')).toBe('gpt-4o-transcribe-diarize');
      expect(form.get('response_format')).toBe('diarized_json');
      expect(form.get('chunking_strategy')).toBe('auto');
      return Response.json({ segments: [{ start: 0.2, end: 0.9, text: 'hi', speaker: 'A' }, { start: 0.9, end: 1, text: 'yes', speaker: 'B' }] });
    }) as typeof fetch;
    recording.status = 'processing';
    await store.save(recording);
    await new RecordingProcessor(store, async () => ({ microphone: 'test', system: 'test' })).process(recording);
    const result = await store.read(recording.id);
    expect(result.status).toBe('complete');
    expect(result.segments.map(segment => segment.speakerId)).toEqual(['you', 'speaker-1', 'speaker-2']);
    expect(result.audioFiles).toEqual([]);
    expect(await fs.stat(path.join(await store.directory(recording.id), 'microphone.flac')).catch(() => null)).toBeNull();
    expect(requests).toEqual(['whisper-large-v3-turbo', 'gpt-4o-transcribe-diarize']);
  });

  test('retains audio on provider failure and reuses microphone results on retry', async () => {
    const { recording, directory } = await store.create({ keepAudio: true });
    await fixtureAudio(directory);
    let fail = true, microphoneRequests = 0;
    globalThis.fetch = (async url => {
      if (String(url).includes('groq')) { microphoneRequests++; return Response.json({ text: 'hello', segments: [{ start: 0, end: 0.5, text: 'hello' }] }); }
      if (fail) return Response.json({ error: { message: 'try later' } }, { status: 429, headers: { 'x-request-id': 'openai-456' } });
      return Response.json({ segments: [] });
    }) as typeof fetch;
    const processor = new RecordingProcessor(store, async () => ({ microphone: 'test', system: 'test' }));
    await expect(processor.process(recording)).rejects.toThrow('Desktop speaker labeling failed for part 1: OpenAI transcription failed (HTTP 429): try later [request ID: openai-456]');
    expect((await fs.stat(path.join(await store.directory(recording.id), 'microphone.flac'))).size).toBeGreaterThan(0);
    fail = false;
    await processor.process(recording);
    expect(microphoneRequests).toBe(1);
    expect((await store.read(recording.id)).audioFiles).toEqual(['microphone.flac', 'system.flac']);
  });
});

test('Companion can read transcripts but cannot patch, move, delete, or transfer into them', async () => {
  const { directory, recording } = await store.create({});
  const home = store.homeRoot;
  await store.publish(recording.id);
  let calls = 0;
  const target = protectCompanionTranscripts({ descriptor: { id: 'home', kind: 'local', rootLabel: home, label: 'home', capabilities: [] },
    execute: async () => { calls++; return { content: [{ type: 'text', text: 'ok' }] }; },
    transfer: { destination: { createDirectory: async () => {}, prepareFile: async () => ({ offset: 0 }), writeChunk: async () => ({ offset: 0 }), commitFile: async () => {} } },
  }, home);
  await target.execute({ callId: 'read', tool: 'read_file', args: { path: 'transcripts/test/transcript.md' } });
  await target.execute({ callId: 'write', tool: 'write_file', args: { path: 'uploads/notes.txt' } });
  for (const call of [
    { tool: 'write_file', args: { path: 'uploads/../transcripts/test' } },
    { tool: 'delete_directory', args: { path: '.' } },
    { tool: 'move_path', args: { from: 'transcripts', to: 'uploads/moved' } },
    { tool: 'apply_patch', args: { patch: '*** Begin Patch\n*** Update File: uploads/note\n*** Move to: transcripts/test\n*** End Patch' } },
  ]) await expect(target.execute({ callId: 'blocked', ...call })).rejects.toThrow('read-only');
  await fs.symlink(path.join(home, 'transcripts'), path.join(home, 'alias'));
  await expect(target.execute({ callId: 'alias', tool: 'write_file', args: { path: 'alias/new.md' } })).rejects.toThrow('read-only');
  await expect(target.transfer!.destination!.prepareFile({ path: 'transcripts/new', transferId: 'a', size: 0, overwrite: true })).rejects.toThrow('read-only');
  expect(calls).toBe(2);
});

async function fixtureAudio(directory: string) {
  const outputs = captureArgs('microphone', 'monitor').slice(captureArgs('microphone', 'monitor').indexOf('-map'));
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', ...outputs], { cwd: directory, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(error)));
  });
}
