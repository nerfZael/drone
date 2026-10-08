import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SpeechClip, SpeechClipStatus } from '@drone/hub-model';
import { droneRootPath } from '../../host/paths';
import { writeRecordingFile as atomicWrite } from '../recordings/recording-files';

export const SPEECH_CLIP_MAX_BYTES = 100 * 1024 * 1024;
/** A transcription that outlives this is from a Hub that stopped mid-request. */
const TRANSCRIBING_STALE_MS = 10 * 60_000;

export type SpeechClipInput = {
  audio: Buffer;
  mimeType?: string | null;
  status: SpeechClipStatus;
  surface?: unknown;
  sourceDevice?: string | null;
  target?: unknown;
  text?: unknown;
  error?: unknown;
  model?: unknown;
};

/** Every recording sent for speech-to-text, kept per profile so it can be replayed or transcribed again. */
export class SpeechClipStore {
  constructor(readonly root = droneRootPath('speech-clips')) {}

  async create(input: SpeechClipInput): Promise<SpeechClip> {
    if (!Buffer.isBuffer(input.audio) || input.audio.length === 0) throw new Error('Audio payload is empty.');
    if (input.audio.length > SPEECH_CLIP_MAX_BYTES) throw new Error('Audio payload is too large.');
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
    const mimeType = cleanMime(input.mimeType);
    const directory = path.join(this.root, id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const clip: SpeechClip = {
      schemaVersion: 1,
      id,
      createdAt,
      updatedAt: createdAt,
      status: input.status,
      surface: label(input.surface, 40) || 'unknown',
      sourceDevice: label(input.sourceDevice, 120) || null,
      target: label(input.target, 200) || null,
      mimeType,
      audioBytes: input.audio.length,
      durationMs: wavDurationMs(input.audio),
      text: typeof input.text === 'string' ? input.text.trim().slice(0, 200_000) : '',
      error: label(input.error, 4000) || null,
      model: label(input.model, 120) || null,
      transcribedAt: input.status === 'transcribed' ? createdAt : null,
    };
    try {
      await fs.writeFile(path.join(directory, audioName(mimeType)), input.audio, { mode: 0o600, flag: 'wx' });
      await this.save(clip);
    } catch (error) {
      // Without clip.json the audio would be invisible yet still take up space.
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
    return clip;
  }

  async read(id: string): Promise<SpeechClip> {
    const value = JSON.parse(await fs.readFile(path.join(this.directory(id), 'clip.json'), 'utf8'));
    if (value?.schemaVersion !== 1 || value.id !== id) throw new Error('Invalid speech clip metadata.');
    return visible(value);
  }

  async list(): Promise<SpeechClip[]> {
    return (await this.summary()).clips;
  }

  /**
   * Every clip, newest first, and the bytes their folders take on disk (metadata included,
   * so the total matches what deleting them would free). One pass over the folders.
   */
  async summary(): Promise<{ clips: SpeechClip[]; bytes: number }> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const clips: SpeechClip[] = [];
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !isId(entry.name)) continue;
      const directory = path.join(this.root, entry.name);
      for (const name of await fs.readdir(directory).catch(() => [] as string[])) {
        bytes += (await fs.lstat(path.join(directory, name)).catch(() => null))?.size ?? 0;
      }
      // A damaged clip must not hide the others.
      try { clips.push(await this.read(entry.name)); } catch { /* skip */ }
    }
    return { clips: clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), bytes };
  }

  async update(id: string, patch: Partial<Pick<SpeechClip, 'status' | 'text' | 'error' | 'model'>>): Promise<SpeechClip> {
    const clip = await this.read(id);
    Object.assign(clip, patch);
    if (patch.status === 'transcribed') clip.transcribedAt = new Date().toISOString();
    await this.save(clip);
    return clip;
  }

  async audio(id: string): Promise<{ file: string; mimeType: string; size: number }> {
    const clip = await this.read(id);
    const file = path.join(this.directory(id), audioName(clip.mimeType));
    const info = await fs.lstat(file);
    if (!info.isFile()) throw new Error('Speech clip audio is missing.');
    return { file, mimeType: clip.mimeType, size: info.size };
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.directory(id), { recursive: true, force: true });
  }

  private async save(clip: SpeechClip): Promise<void> {
    clip.updatedAt = new Date().toISOString();
    await atomicWrite(path.join(this.directory(clip.id), 'clip.json'), JSON.stringify(clip, null, 2) + '\n');
  }

  private directory(id: string): string {
    if (!isId(id)) throw Object.assign(new Error('Invalid speech clip ID.'), { code: 'SPEECH_CLIP_NOT_FOUND' });
    return path.join(this.root, id);
  }
}

function visible(clip: SpeechClip): SpeechClip {
  if (clip.status === 'transcribing' && Date.now() - Date.parse(clip.updatedAt) > TRANSCRIBING_STALE_MS) {
    return { ...clip, status: 'failed', error: 'Transcription was interrupted.' };
  }
  return clip;
}

function isId(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/.test(value);
}

function label(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
}

function cleanMime(value: unknown): string {
  const mime = String(value ?? '').split(';')[0]!.trim().toLowerCase();
  return /^audio\/[a-z0-9.+-]{1,40}$/.test(mime) ? mime : 'audio/webm';
}

export function audioName(mimeType: string): string {
  if (mimeType.includes('wav')) return 'audio.wav';
  if (mimeType.includes('ogg')) return 'audio.ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return 'audio.m4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'audio.mp3';
  if (mimeType.includes('flac')) return 'audio.flac';
  if (mimeType.includes('3gpp')) return 'audio.3gp';
  return 'audio.webm';
}

function wavDurationMs(audio: Buffer): number | null {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return null;
  const byteRate = audio.readUInt32LE(28);
  return byteRate > 0 ? Math.round(((audio.length - 44) / byteRate) * 1000) : null;
}
