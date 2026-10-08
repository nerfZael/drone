import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SpeechClipStatus } from '@drone/hub-model';
import type { WorkspaceHttpTransfers } from './workspace-http-transfers';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ACTIVE_PER_DEVICE = 8;
const TTL_MS = 15 * 60_000;

type Upload = { source: string; file: string; size: number; expires: number; complete: boolean };

export type RecordSpeechClip = (input: {
  audio: Buffer;
  mimeType: string;
  status: SpeechClipStatus;
  surface: unknown;
  sourceDevice: string;
  target: unknown;
  text: unknown;
  error: unknown;
  model: unknown;
}) => Promise<{ id: string }>;

/** Phones transcribe on-device; this lets them file the recording with the Hub they dictated to. */
export class MeshSpeechClipUploads {
  private readonly uploads = new Map<string, Upload>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly root: string,
    private readonly transfers: Pick<WorkspaceHttpTransfers, 'issue'>,
    private readonly record: RecordSpeechClip,
  ) {
    this.timer = setInterval(() => void this.prune(), 60_000);
    this.timer.unref?.();
  }

  async prepare(source: string, payload: Record<string, unknown>) {
    const size = Number(payload.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) {
      throw Object.assign(new Error(`speech clip size must be between 1 and ${MAX_BYTES} bytes`), { code: 'INVALID_REQUEST' });
    }
    await this.prune();
    if ([...this.uploads.values()].filter((upload) => upload.source === source).length >= MAX_ACTIVE_PER_DEVICE) {
      throw Object.assign(new Error('Too many speech clip uploads are in progress.'), { code: 'BUSY' });
    }
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const uploadId = crypto.randomUUID();
    const upload: Upload = { source, file: path.join(this.root, uploadId), size, expires: Date.now() + TTL_MS, complete: false };
    await (await fs.open(upload.file, 'wx', 0o600)).close();
    this.uploads.set(uploadId, upload);
    try {
      const ticket = this.transfers.issue({
        source,
        method: 'PUT',
        size,
        resolve: async () => upload.file,
        authorized: async () => this.uploads.get(uploadId) === upload && Date.now() < upload.expires,
        completed: () => { upload.complete = true; },
      });
      return { uploadId, uploadUrl: ticket.url, uploadToken: ticket.token };
    } catch (error) {
      await this.discard(uploadId);
      throw error;
    }
  }

  async commit(source: string, sourceName: string, payload: Record<string, unknown>) {
    const uploadId = String(payload.uploadId ?? '');
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.source !== source) {
      throw Object.assign(new Error('speech clip upload not found'), { code: 'NOT_FOUND' });
    }
    try {
      if (!upload.complete) throw Object.assign(new Error('speech clip upload is incomplete'), { code: 'INVALID_REQUEST' });
      const status = payload.status;
      if (status !== 'transcribed' && status !== 'failed' && status !== 'canceled') {
        throw Object.assign(new Error('invalid speech clip status'), { code: 'INVALID_REQUEST' });
      }
      const clip = await this.record({
        audio: await fs.readFile(upload.file),
        mimeType: String(payload.mimeType ?? ''),
        status,
        surface: payload.surface,
        sourceDevice: sourceName,
        target: payload.target,
        text: payload.text,
        error: payload.error,
        model: payload.model,
      });
      return { clipId: clip.id };
    } finally {
      await this.discard(uploadId);
    }
  }

  async abort(source: string, payload: Record<string, unknown>) {
    const uploadId = String(payload.uploadId ?? '');
    if (this.uploads.get(uploadId)?.source === source) await this.discard(uploadId);
    return { ok: true };
  }

  close(): void {
    clearInterval(this.timer);
  }

  private async discard(uploadId: string) {
    const upload = this.uploads.get(uploadId);
    this.uploads.delete(uploadId);
    if (upload) await fs.rm(upload.file, { force: true });
  }

  private async prune() {
    for (const [id, upload] of this.uploads) if (upload.expires <= Date.now()) await this.discard(id);
  }
}
