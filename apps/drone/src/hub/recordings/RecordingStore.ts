import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { companionHomeRoot } from '../companion/companion-attachments';
import { droneRootPath } from '../../host/paths';
import type { DesktopRecording } from '@drone/hub-model';
import { writeRecordingFile as atomicWrite } from './recording-files';

export type CaptureFinished = { durationSeconds: number; error?: string };

export class RecordingStore {
  constructor(readonly homeRoot = companionHomeRoot(), readonly pendingRoot = droneRootPath('recordings', 'pending')) {}

  async create(input: { title?: unknown; keepAudio?: unknown; liveTranscription?: unknown }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid recording options.');
    const startedAt = new Date().toISOString();
    const id = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
    const directory = path.join(this.pendingRoot, id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    for (const source of ['microphone', 'system']) await fs.mkdir(path.join(directory, source), { mode: 0o700 });
    const recording: DesktopRecording = {
      schemaVersion: 1, id, title: titleOf(input.title) || `Recording ${startedAt.slice(0, 16).replace('T', ' ')}`,
      startedAt, durationSeconds: 0, status: 'recording', keepAudio: input.keepAudio === true,
      liveTranscription: input.liveTranscription !== false, audioFiles: [], segments: [], previewSegments: [], previewChunks: 0,
      error: null, warnings: [], providers: { microphone: 'groq/whisper-large-v3-turbo', system: 'openai/gpt-4o-transcribe-diarize' }, updatedAt: startedAt,
    };
    await this.save(recording);
    await this.heartbeat(id);
    return { recording, directory };
  }

  async heartbeat(id: string) {
    await atomicWrite(path.join(await this.directory(id), 'capture-heartbeat'), String(Date.now()));
  }

  async finishCapture(id: string, receipt: CaptureFinished) {
    await atomicWrite(path.join(await this.directory(id), 'capture-finished.json'), JSON.stringify(receipt));
  }

  async captureFinished(id: string): Promise<CaptureFinished | null> {
    try { return JSON.parse(await fs.readFile(await this.file(await this.directory(id), 'capture-finished.json'), 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; return null; }
  }

  async lastHeartbeat(recording: DesktopRecording) {
    try { return (await fs.stat(await this.file(await this.directory(recording.id), 'capture-heartbeat'))).mtimeMs; }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; return Date.parse(recording.updatedAt); }
  }

  async directory(id: string): Promise<string> {
    validateId(id);
    for (const candidate of [path.join(this.pendingRoot, id), this.publishedDirectory(id)]) {
      try {
        const real = await fs.realpath(candidate);
        // Managed bundles must not redirect reads, provider uploads, or deletion through symlinks.
        if (real !== path.resolve(candidate)) throw new Error('Recording paths must not contain symlinks.');
        return real;
      } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
    throw Object.assign(new Error('Recording not found.'), { code: 'RECORDING_NOT_FOUND' });
  }

  async read(id: string): Promise<DesktopRecording> {
    const directory = await this.directory(id);
    const file = await this.file(directory, 'transcript.json');
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.schemaVersion !== 1 || value.id !== id || !Array.isArray(value.segments)) throw new Error('Invalid recording metadata.');
    return value;
  }

  async file(directory: string, name: string): Promise<string> {
    const target = path.resolve(directory, name);
    if (!target.startsWith(directory + path.sep) || await fs.realpath(target) !== target) throw new Error('Invalid recording file.');
    return target;
  }

  async save(recording: DesktopRecording): Promise<void> {
    const directory = await this.directory(recording.id);
    recording.updatedAt = new Date().toISOString();
    // JSON is canonical. Publish the readable view first and commit status in JSON last.
    await atomicWrite(path.join(directory, 'transcript.md'), recordingMarkdown(recording));
    await atomicWrite(path.join(directory, 'transcript.json'), JSON.stringify(recording, null, 2) + '\n');
  }

  async publish(id: string) {
    const directory = await this.directory(id);
    const destination = this.publishedDirectory(id);
    if (directory !== destination) {
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      if (await fs.realpath(path.dirname(destination)) !== path.dirname(destination)) throw new Error('Transcript paths must not contain symlinks.');
      await fs.rename(directory, destination);
    }
    return destination;
  }

  async list(): Promise<DesktopRecording[]> {
    const ids = new Set<string>();
    const collect = async (directory: string, depth: number): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (depth) { if (/^\d{2,4}$/.test(entry.name)) await collect(path.join(directory, entry.name), depth - 1); }
        else { try { validateId(entry.name); ids.add(entry.name); } catch { /* unrelated directory */ } }
      }
    };
    await collect(this.pendingRoot, 0);
    await collect(path.join(this.homeRoot, 'transcripts'), 2);
    const recordings = [];
    for (const id of ids) {
      try { recordings.push(await this.read(id)); } catch { /* A malformed user-edited bundle must not hide other recordings. */ }
    }
    return recordings.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async rename(id: string, title: unknown) {
    const recording = await this.read(id);
    recording.title = titleOf(title);
    if (!recording.title) throw new Error('A title is required.');
    await this.save(recording);
    return recording;
  }

  async removeAudio(recording: DesktopRecording) {
    const directory = await this.directory(recording.id);
    for (const name of ['microphone', 'system', 'microphone.flac', 'system.flac', 'system.mp3', 'processing']) {
      await fs.rm(path.join(directory, name), { recursive: true, force: true });
    }
    recording.audioFiles = [];
    recording.keepAudio = false;
    await this.save(recording);
  }

  async remove(id: string) { await fs.rm(await this.directory(id), { recursive: true }); }

  relativePath(id: string) { validateId(id); return path.relative(this.homeRoot, this.publishedDirectory(id)); }

  private publishedDirectory(id: string) { validateId(id); return path.join(this.homeRoot, 'transcripts', id.slice(0, 4), id.slice(5, 7), id); }
}

export function recordingMarkdown(recording: DesktopRecording): string {
  const speakerCount = new Set(recording.segments.map(segment => segment.speakerId)).size;
  const header = `---\nid: ${recording.id}\ntitle: ${JSON.stringify(recording.title)}\nstarted_at: ${recording.startedAt}\nduration_seconds: ${recording.durationSeconds}\nspeaker_count: ${speakerCount}\nstatus: ${recording.status}\naudio_retained: ${recording.audioFiles.length > 0}\n---\n\n# ${escapeMarkdown(recording.title)}\n\n`;
  const notice = [recording.error, recording.captureError, ...recording.warnings].filter(Boolean).map(text => `> ${escapeMarkdown(text!)}\n\n`).join('');
  return header + notice + recording.segments.map(segment => {
    const seconds = Math.floor(segment.start);
    const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    const speaker = segment.speakerId === 'you' ? 'You' : `Speaker ${segment.speakerId.replace('speaker-', '')}`;
    return `[${time}] **${speaker}:** ${escapeMarkdown(segment.text)}\n`;
  }).join('\n');
}

function validateId(id: string) {
  if (typeof id !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid recording ID.');
}
function titleOf(value: unknown) { return typeof value === 'string' ? value.replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 200) : ''; }
function escapeMarkdown(value: string) { return value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>#]/g, '\\$&'); }
