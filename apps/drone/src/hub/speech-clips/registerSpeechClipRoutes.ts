import fs from 'node:fs';
import type http from 'node:http';
import type { SpeechClip, SpeechClipStatus } from '@drone/hub-model';
import type { HubRouter } from '../hub-router';
import { readRawBody } from '../hub-http';
import { transcribeAudioWithGroq } from '../groq-transcription';
import { REMOTE_DEVICE_HEADER } from '../device-mesh/hub-remote-http';
import { SPEECH_CLIP_MAX_BYTES, SpeechClipStore, type SpeechClipInput } from './SpeechClipStore';

type Transcribe = (audio: Buffer, mimeType: string) => Promise<{ text: string; model: string }>;
type Log = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;

/** Keeps recordings next to their transcripts. Recording is best-effort: it never fails a transcription. */
export class SpeechClipService {
  private readonly retranscribing = new Set<string>();
  constructor(
    readonly store: SpeechClipStore,
    private readonly transcribe: Transcribe,
    private readonly log: Log,
  ) {}

  async begin(input: Omit<SpeechClipInput, 'status'>): Promise<string | null> {
    try { return (await this.store.create({ ...input, status: 'transcribing' })).id; }
    catch (error) { this.log('warn', 'speech clip could not be saved', { error: message(error) }); return null; }
  }

  async finish(id: string | null, outcome: { text: string; model: string } | { error: string }): Promise<void> {
    if (!id) return;
    try {
      await this.store.update(id, 'error' in outcome
        ? { status: 'failed', error: outcome.error }
        : { status: 'transcribed', text: outcome.text, model: outcome.model, error: null });
    } catch (error) {
      // The user may delete a clip while it is still being transcribed.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      this.log('warn', 'speech clip result could not be saved', { clipId: id, error: message(error) });
    }
  }

  async record(input: SpeechClipInput): Promise<SpeechClip> {
    return await this.store.create(input);
  }

  async retranscribe(id: string): Promise<SpeechClip> {
    if (this.retranscribing.has(id)) throw new Error('This clip is already being transcribed.');
    this.retranscribing.add(id);
    try {
      const clip = await this.store.read(id);
      // Stale ones read back as failed, so this only blocks a transcription still under way.
      if (clip.status === 'transcribing') throw new Error('This clip is already being transcribed.');
      const { file, mimeType } = await this.store.audio(id);
      const audio = await fs.promises.readFile(file);
      await this.store.update(clip.id, { status: 'transcribing', error: null });
      try {
        const result = await this.transcribe(audio, mimeType);
        return await this.store.update(clip.id, { status: 'transcribed', text: result.text, model: result.model, error: null });
      } catch (error) {
        return await this.store.update(clip.id, { status: 'failed', error: message(error) });
      }
    } finally { this.retranscribing.delete(id); }
  }
}

export function createSpeechClipService(deps: {
  resolveGroqApiKey: () => Promise<string | null>;
  resolveLanguage: () => Promise<string | null>;
  log: Log;
  store?: SpeechClipStore;
}): SpeechClipService {
  return new SpeechClipService(deps.store ?? new SpeechClipStore(), async (audio, mimeType) => {
    const apiKey = await deps.resolveGroqApiKey();
    if (!apiKey) throw new Error('GROQ API key is not configured. Add it in Drone Hub settings.');
    // A deliberate retry is worth the slower, more accurate model.
    return await transcribeAudioWithGroq({ audio, apiKey, mimeType, quality: 'accurate', language: await deps.resolveLanguage() });
  }, deps.log);
}

/** Recording metadata sent alongside audio by Hub UIs, plus the remote desktop the remote Hub proxy names. */
export function speechClipHeaders(req: http.IncomingMessage): { surface: string; target: string; sourceDevice: string } {
  const header = (name: string) => {
    const raw = String(req.headers[name] ?? '').trim();
    if (!raw) return '';
    try { return decodeURIComponent(raw); } catch { return raw; }
  };
  return {
    surface: header('x-drone-speech-surface'),
    target: header('x-drone-speech-target'),
    sourceDevice: header(REMOTE_DEVICE_HEADER),
  };
}

export function registerSpeechClipRoutes(router: HubRouter, service: SpeechClipService): void {
  // Continuous voice files a clip per phrase, so the list is filtered and paged here.
  router.get('/api/speech-clips', async ({ url, json }) => {
    const { clips, bytes } = await service.store.summary();
    const status = url.searchParams.get('status');
    const matching = status ? clips.filter((clip) => clip.status === status) : clips;
    const limit = Math.min(1_000, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    json(200, { ok: true, clips: matching.slice(0, limit), matching: matching.length, total: clips.length, totalBytes: bytes });
  });

  // Recordings the user discarded never reach the transcription endpoint; clients file them here.
  router.post('/api/speech-clips', async ({ req, url, json, fail }) => {
    try {
      const status = url.searchParams.get('status');
      if (status !== 'canceled') return fail(400, 'Only canceled recordings can be filed directly.');
      const audio = await readRawBody(req, { maxBytes: SPEECH_CLIP_MAX_BYTES });
      const clip = await service.record({
        audio,
        mimeType: String(req.headers['content-type'] ?? ''),
        status: status as SpeechClipStatus,
        ...speechClipHeaders(req),
      });
      json(200, { ok: true, clip });
    } catch (error) { fail(400, message(error)); }
  });

  router.get('/api/speech-clips/:id/audio', async ({ req, params, res, fail }) => {
    let audio: Awaited<ReturnType<SpeechClipStore['audio']>>;
    try { audio = await service.store.audio(params.id); }
    catch (error) { return fail(404, message(error)); }
    const headers = { 'content-type': audio.mimeType, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
    // Media elements seek with byte ranges.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, audio.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), audio.size - 1) : audio.size - 1;
      if (start > end || start >= audio.size) {
        res.writeHead(416, { 'content-range': `bytes */${audio.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${audio.size}` });
      fs.createReadStream(audio.file, { start, end }).on('error', () => res.destroy()).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': audio.size });
    fs.createReadStream(audio.file).on('error', () => res.destroy()).pipe(res);
  });

  router.post('/api/speech-clips/:id/retranscribe', async ({ params, json, fail }) => {
    try { json(200, { ok: true, clip: await service.retranscribe(params.id) }); }
    catch (error) { fail(400, message(error)); }
  });

  router.delete('/api/speech-clips/:id', async ({ params, json, fail }) => {
    try { await service.store.remove(params.id); json(200, { ok: true }); }
    catch (error) { fail(400, message(error)); }
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
