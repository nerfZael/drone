import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RecordingStore } from '../src/hub/recordings/RecordingStore';
import { registerRecordingRoutes } from '../src/hub/recordings/registerRecordingRoutes';
import type { DesktopRecording } from '@drone/hub-model';
import type { HubRouter, HubRouteHandler } from '../src/hub/hub-router';

let root: string;
let store: RecordingStore;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-routes-')); store = new RecordingStore(path.join(root, 'home'), path.join(root, 'pending')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('stop acknowledges slow preview, remains locked during finalization, and is idempotent', async () => {
  const { recording } = await store.create({});
  const previewStarted = deferred(), previewRelease = deferred(), processStarted = deferred(), processRelease = deferred(), completed = deferred();
  let processes = 0;
  const call = routes({
    preview: async snapshot => { previewStarted.resolve(); await previewRelease.promise; snapshot.previewChunks = 1; await store.save(snapshot); },
    process: async snapshot => { processes++; processStarted.resolve(); await processRelease.promise; snapshot.status = 'complete'; await store.save(snapshot); completed.resolve(); },
  });
  try {
    await call('POST /api/recordings/:id/heartbeat', recording.id);
    await previewStarted.promise;
    expect((await call('POST /api/recordings/:id/finish', recording.id, { durationSeconds: 12 })).status).toBe(202);
    expect((await store.captureFinished(recording.id))?.durationSeconds).toBe(12);
    expect((await call('GET /api/recordings/:id', recording.id)).body.recording.status).toBe('processing');
    expect((await call('POST /api/recordings/:id/finish', recording.id, { durationSeconds: 99 })).status).toBe(202);
    // A completed capture must not prevent starting the next recording while its preview drains.
    expect((await call('POST /api/recordings/create', '', {})).status).toBe(200);
    previewRelease.resolve();
    await processStarted.promise;
    expect((await call('POST /api/recordings/:id/action', recording.id, { action: 'delete' })).status).toBe(400);
    processRelease.resolve();
    await completed.promise;
    expect((await store.read(recording.id)).durationSeconds).toBe(12);
    expect(processes).toBe(1);
  } finally { previewRelease.resolve(); processRelease.resolve(); await completed.promise; }
}, 5000);

test('a restart preserves capture errors and stopped recordings can be retried immediately', async () => {
  const { recording } = await store.create({});
  await store.finishCapture(recording.id, { durationSeconds: 8, error: 'Microphone disconnected' });
  const done = deferred();
  const call = routes({ preview: async () => {}, process: async snapshot => {
    expect(snapshot.captureError).toBe('Microphone disconnected');
    snapshot.status = 'complete'; await store.save(snapshot); done.resolve();
  } });
  expect((await call('GET /api/recordings/:id', recording.id)).body.recording.status).toBe('failed');
  expect((await call('POST /api/recordings/:id/action', recording.id, { action: 'retry' })).status).toBe(200);
  await done.promise;
  expect((await store.read(recording.id)).captureError).toBe('Microphone disconnected');
});

test('replaying finish after deletion succeeds instead of blocking every future desktop recording', async () => {
  const { recording } = await store.create({});
  await store.remove(recording.id);
  const call = routes({ preview: async () => {}, process: async () => {} });
  expect((await call('POST /api/recordings/:id/finish', recording.id, {})).status).toBe(200);
});

test('recovery after a desktop crash keeps an interruption notice in the completed transcript', async () => {
  const { recording, directory } = await store.create({});
  const stale = new Date(Date.now() - 65_000);
  await fs.utimes(path.join(directory, 'capture-heartbeat'), stale, stale);
  const done = deferred();
  const call = routes({ preview: async () => {}, process: async snapshot => {
    snapshot.status = 'complete'; await store.save(snapshot); done.resolve();
  } });
  expect((await call('POST /api/recordings/:id/action', recording.id, { action: 'retry' })).status).toBe(200);
  await done.promise;
  expect((await store.read(recording.id)).captureError).toContain('without a confirmed stop');
  expect(await fs.readFile(path.join(await store.directory(recording.id), 'transcript.md'), 'utf8')).toContain('final audio segment may be missing');
});

function routes(processor: { preview(recording: DesktopRecording): Promise<void>; process(recording: DesktopRecording): Promise<void> }) {
  const handlers = new Map<string, HubRouteHandler>();
  const router = { get: (route: string, handler: HubRouteHandler) => handlers.set(`GET ${route}`, handler), post: (route: string, handler: HubRouteHandler) => handlers.set(`POST ${route}`, handler) };
  registerRecordingRoutes(router as unknown as HubRouter, { store, processor, keys: async () => ({ microphone: 'test', system: 'test' }) });
  return async (route: string, id: string, body: unknown = {}) => {
    let result: { status: number; body: any } = { status: 0, body: null };
    try {
      await handlers.get(route)!({ params: { id }, readJson: async () => body,
        json: (status: number, data: unknown) => { result = { status, body: data }; },
        fail: (status: number, message: string) => { throw { status, body: { error: message } }; },
      } as any);
    } catch (error: any) { if (error.status) result = error; else throw error; }
    return result;
  };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
