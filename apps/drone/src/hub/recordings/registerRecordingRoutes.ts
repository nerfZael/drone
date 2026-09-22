import type { HubRouter } from '../hub-router';
import path from 'node:path';
import { resolveEffectiveProviderApiKeySettings, resolveGroqApiKeySettings } from '../hub-settings';
import { RecordingStore } from './RecordingStore';
import { RecordingProcessor } from './RecordingProcessor';
import { exportRecording } from './exportRecording';
import type { DesktopRecording } from '@drone/hub-model';

type RecordingDependencies = {
  store?: RecordingStore;
  processor?: Pick<RecordingProcessor, 'preview' | 'process'>;
  keys?: typeof recordingKeys;
};

export function registerRecordingRoutes(router: HubRouter, dependencies: RecordingDependencies = {}) {
  const store = dependencies.store ?? new RecordingStore();
  const keys = dependencies.keys ?? recordingKeys;
  const processor = dependencies.processor ?? new RecordingProcessor(store, keys);
  const jobs = new Map<string, Promise<void>>();
  const leases = new Map<string, number>();
  const mutations = new Set<string>();
  let creating = false;
  const heartbeatOf = (recording: DesktopRecording) => leases.get(recording.id) ?? store.lastHeartbeat(recording);
  const visibleState = async (recording: DesktopRecording): Promise<DesktopRecording> => {
    const receipt = recording.status === 'recording' ? await store.captureFinished(recording.id) : null;
    if (receipt) return { ...recording, ...captureDetails(receipt), status: jobs.has(recording.id) ? 'processing' : 'failed',
      error: jobs.has(recording.id) ? null : 'Processing was interrupted. Retry to process the saved audio.' };
    const interrupted = recording.status === 'recording' && Date.now() - await heartbeatOf(recording) >= 60_000;
    const abandoned = recording.status === 'processing' && !jobs.has(recording.id) && !mutations.has(recording.id);
    return interrupted || abandoned ? { ...recording, status: 'failed', error: 'Recording or processing was interrupted. Retry to process the saved audio.' } : recording;
  };
  const trackJob = (id: string, work: () => Promise<void>) => {
    const job = Promise.resolve().then(work).finally(() => { if (jobs.get(id) === job) jobs.delete(id); });
    jobs.set(id, job);
    void job.catch(error => console.error('Could not persist recording job:', message(error)));
  };
  const processAndPersist = async (recording: DesktopRecording) => {
    try { await processor.process(recording); }
    catch (error) {
      if (recording.status === 'complete') recording.warnings.push(`Transcript is complete, but audio cleanup failed: ${message(error)}`);
      else { recording.status = 'failed'; recording.error = message(error); }
      await store.save(recording);
    }
  };
  const startJob = (recording: DesktopRecording) => trackJob(recording.id, () => processAndPersist(recording));
  const assertIdle = async (id: string) => {
    if (jobs.has(id)) throw new Error('This recording is still being processed.');
    const recording = await store.read(id);
    const heartbeat = await heartbeatOf(recording);
    if (recording.status === 'recording' && !await store.captureFinished(id) && Date.now() - heartbeat < 60_000) throw new Error('Stop recording first.');
    return recording;
  };
  router.get('/api/recordings', async ({ json }) => {
    const recordings = await Promise.all((await store.list()).map(visibleState));
    const summaries = [];
    for (const { segments, previewSegments: _preview, ...recording } of recordings) summaries.push({
      ...recording, relativePath: store.relativePath(recording.id), speakerCount: new Set(segments.map(segment => segment.speakerId)).size,
      inHomeFiles: (await store.directory(recording.id)).startsWith(store.homeRoot + path.sep),
    });
    json(200, { ok: true, recordings: summaries });
  });
  router.get('/api/recordings/:id', async ({ params, json, fail }) => {
    try { json(200, { ok: true, recording: await visibleState(await store.read(params.id)) }); }
    catch (error) { fail(404, message(error)); }
  });
  router.get('/api/recordings/:id/export', async ({ params, res, fail }) => {
    if (mutations.has(params.id)) return fail(409, 'A recording action is already in progress.');
    mutations.add(params.id);
    try {
      const recording = await assertIdle(params.id);
      if (recording.status !== 'complete') throw new Error('Finish transcription before exporting the bundle.');
      await exportRecording(store, recording.id, res);
    } catch (error) { if (!res.headersSent) fail(400, message(error)); else res.destroy(); }
    finally { mutations.delete(params.id); }
  });
  router.post('/api/recordings/create', async ({ readJson, json, fail }) => {
    if (creating) return fail(409, 'A recording is already starting.');
    creating = true;
    try {
      await keys();
      for (const recording of await store.list()) {
        if (recording.status === 'recording' && !await store.captureFinished(recording.id) && Date.now() - await heartbeatOf(recording) < 60_000) throw new Error('A desktop recording is already active.');
      }
      const result = await store.create(await readJson());
      leases.set(result.recording.id, Date.now());
      json(200, { ok: true, ...result });
    } catch (error) { fail(400, message(error)); }
    finally { creating = false; }
  });
  router.post('/api/recordings/:id/heartbeat', async ({ params, json, fail }) => {
    try {
      const recording = await store.read(params.id);
      if (mutations.has(recording.id) || await store.captureFinished(recording.id)) { json(200, { ok: true }); return; }
      if (recording.status !== 'recording') throw new Error('Recording is no longer active.');
      await store.heartbeat(recording.id);
      leases.set(recording.id, Date.now());
      if (!jobs.has(recording.id) && !mutations.has(recording.id)) {
        trackJob(recording.id, async () => {
          try { await processor.preview(recording); }
          catch (error) { recording.previewError = message(error); await store.save(recording); }
        });
      }
      json(200, { ok: true });
    } catch (error) { fail(400, message(error)); }
  });
  router.post('/api/recordings/:id/finish', async ({ params, readJson, json, fail }) => {
    if (mutations.has(params.id)) return fail(409, 'A recording action is already in progress.');
    mutations.add(params.id);
    try {
      const body = await readJson();
      const recording = await store.read(params.id);
      if (recording.status !== 'recording') { json(200, { ok: true }); return; }
      const existingReceipt = await store.captureFinished(recording.id);
      if (existingReceipt && jobs.has(recording.id)) { json(202, { ok: true }); return; }
      const receipt = existingReceipt ?? {
        durationSeconds: Math.max(0, Math.min(7 * 86400, Number(body.durationSeconds) || 0)),
        error: typeof body.error === 'string' && body.error ? body.error.slice(0, 4000) : undefined,
      };
      // Persist stop independently of a preview that may still be waiting on its provider.
      await store.finishCapture(recording.id, receipt);
      const preview = jobs.get(recording.id);
      trackJob(recording.id, async () => {
        await preview?.catch(() => {});
        const latest = await store.read(recording.id);
        Object.assign(latest, captureDetails(receipt));
        latest.status = receipt.error ? 'failed' : 'processing';
        latest.error = receipt.error ? 'Capture was interrupted. Retry to process the audio saved before the interruption.' : null;
        try {
          await store.publish(latest.id);
          await store.save(latest);
          if (!receipt.error) await processAndPersist(latest);
        } catch (error) { latest.status = 'failed'; latest.error = message(error); await store.save(latest); }
      });
      leases.delete(recording.id);
      json(202, { ok: true });
    } catch (error) {
      // An old, already-stopped capture may have been deleted while its desktop was offline.
      if ((error as { code?: string }).code === 'RECORDING_NOT_FOUND') json(200, { ok: true });
      else fail(400, message(error));
    }
    finally { mutations.delete(params.id); }
  });
  router.post('/api/recordings/:id/action', async ({ params, readJson, json, fail }) => {
    if (mutations.has(params.id)) return fail(409, 'A recording action is already in progress.');
    mutations.add(params.id);
    try {
      const body = await readJson();
      const recording = await assertIdle(params.id);
      if (body.action === 'retry') {
        if (recording.status === 'complete') throw new Error('This transcript is already complete.');
        await keys();
        const receipt = await store.captureFinished(recording.id);
        if (receipt) Object.assign(recording, captureDetails(receipt));
        else if (recording.status === 'recording') recording.captureError = 'Capture ended without a confirmed stop. The final audio segment may be missing.';
        recording.status = 'processing'; recording.error = null;
        await store.publish(recording.id); await store.save(recording); startJob(recording);
      } else if (body.action === 'rename') await store.rename(recording.id, body.title);
      else if (body.action === 'delete-audio') {
        if (recording.status !== 'complete') throw new Error('Finish transcription before deleting its source audio.');
        await store.removeAudio(recording);
      } else if (body.action === 'delete') await store.remove(recording.id);
      else throw new Error('Unknown recording action.');
      json(200, { ok: true });
    } catch (error) { fail(400, message(error)); }
    finally { mutations.delete(params.id); }
  });
}

async function recordingKeys() {
  const [microphone, system] = await Promise.all([resolveGroqApiKeySettings(), resolveEffectiveProviderApiKeySettings('openai')]);
  if (!microphone.apiKey || !system.apiKey) throw new Error('Configure both GROQ and OpenAI API keys in Settings before recording.');
  return { microphone: microphone.apiKey, system: system.apiKey };
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

function captureDetails(receipt: import('./RecordingStore').CaptureFinished) {
  return { durationSeconds: receipt.durationSeconds, captureError: receipt.error };
}
