import fs from 'node:fs/promises';
import path from 'node:path';
import type { RecordingStore } from './RecordingStore';
import type { DesktopRecording, RecordingSegment, RecordingSource } from '@drone/hub-model';
import { audioDuration, diarizeRecording, mergeRecordingSegments, parseDiarizedSegments, runAudioCommand, transcribeRecordingChunk } from './recording-audio';
import { writeRecordingFile } from './recording-files';

type Keys = { microphone: string; system: string };
type Chunk = { name: string; start: number; end: number };

export class RecordingProcessor {
  constructor(private readonly store: RecordingStore, private readonly keys: () => Promise<Keys>) {}

  async preview(recording: DesktopRecording) {
    if (!recording.liveTranscription) return;
    const directory = await this.store.directory(recording.id);
    const microphone = await this.chunks(directory, 'microphone');
    const system = await this.chunks(directory, 'system');
    const count = Math.min(microphone.length, system.length);
    if (count <= recording.previewChunks) return;
    const keys = await this.keys();
    // One chunk per tick bounds work when the provider is slower than real time.
    const index = recording.previewChunks;
    const segments: RecordingSegment[] = [];
    for (const source of ['microphone', 'system'] as const) {
      const chunk = (source === 'microphone' ? microphone : system)[index];
      segments.push(...await this.transcribeCached(directory, source, chunk, keys.microphone));
    }
    recording.previewSegments = mergeRecordingSegments(recording.previewSegments, segments);
    recording.previewChunks++;
    recording.previewError = undefined;
    await this.store.save(recording);
  }

  async process(recording: DesktopRecording) {
    const directory = await this.store.publish(recording.id);
    const keys = await this.keys();
    const microphone = await this.chunks(directory, 'microphone');
    const system = await this.chunks(directory, 'system');
    if (!microphone.length || !system.length) throw new Error('No finalized audio was captured from both sources.');
    const micSegments: RecordingSegment[] = [];
    for (const chunk of microphone) micSegments.push(...await this.transcribeCached(directory, 'microphone', chunk, keys.microphone));
    recording.segments = mergeRecordingSegments(micSegments, []);
    await this.store.save(recording);
    for (const [source, chunks] of [['microphone', microphone], ['system', system]] as const) {
      await this.combine(directory, source, chunks);
    }
    const duration = await audioDuration(await this.store.file(directory, 'system.flac'));
    recording.durationSeconds = Math.max(duration, microphone.at(-1)!.end);
    const systemSegments: RecordingSegment[] = [];
    let speakerNumber = 0;
    // A 32 kb/s, 90-minute MP3 stays under 24 MB. Normal meetings use one request, so
    // anonymous speaker IDs are consistent across the whole system track.
    const partSeconds = 90 * 60;
    if (duration > partSeconds) recording.warnings = [...new Set([...recording.warnings,
      'This recording exceeds 90 minutes. Speaker numbers are assigned separately in each 90-minute part; the same person may receive another number.'])];
    for (let offset = 0, part = 0; offset < duration; offset += partSeconds, part++) {
      const mp3 = path.join(directory, 'processing', `system-${part}.mp3`);
      await fs.rm(mp3, { force: true });
      await runAudioCommand(['-nostdin', '-v', 'error', '-n', '-ss', String(offset), '-i', path.join(directory, 'system.flac'), '-t', String(partSeconds), '-ar', '16000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', mp3]);
      const cache = path.join(directory, 'processing', `diarized-${part}.json`);
      let diarized;
      try { diarized = parseDiarizedSegments(JSON.parse(await fs.readFile(await this.store.file(directory, path.relative(directory, cache)), 'utf8'))); }
      catch (error: any) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        diarized = await diarizeRecording(mp3, keys.system);
        await writeRecordingFile(cache, JSON.stringify(diarized));
      }
      const speakers = new Map<string, string>();
      for (const segment of diarized) {
        if (!speakers.has(segment.speaker)) speakers.set(segment.speaker, `speaker-${++speakerNumber}`);
        systemSegments.push({ start: segment.start + offset, end: segment.end + offset, text: segment.text, source: 'system', speakerId: speakers.get(segment.speaker)! });
      }
      recording.segments = mergeRecordingSegments(micSegments, systemSegments);
      await this.store.save(recording);
    }
    recording.status = 'complete';
    recording.error = null;
    recording.previewSegments = [];
    recording.audioFiles = ['microphone.flac', 'system.flac'];
    // Commit a usable transcript before applying retention. A crash during cleanup must
    // never leave a failed job whose only source audio has already been deleted.
    await this.store.save(recording);
    if (!recording.keepAudio) await this.store.removeAudio(recording);
    else {
      for (const name of ['microphone', 'system', 'processing']) await fs.rm(path.join(directory, name), { recursive: true, force: true });
    }
  }

  private async chunks(directory: string, source: RecordingSource): Promise<Chunk[]> {
    let csv: string;
    try { csv = await fs.readFile(await this.store.file(directory, `${source}.csv`), 'utf8'); }
    catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
    // The segment muxer appends a CSV row only after closing that FLAC file.
    return csv.split('\n').filter(Boolean).map(line => {
      const match = /^(?:microphone\/|system\/)?(\d{6}\.flac),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(line.trim());
      if (!match || Number(match[3]) < Number(match[2])) throw new Error('Invalid recording segment manifest.');
      return { name: `${source}/${match[1]}`, start: Number(match[2]), end: Number(match[3]) };
    });
  }

  private async transcribeCached(directory: string, source: RecordingSource, chunk: Chunk, key: string): Promise<RecordingSegment[]> {
    const cacheName = `processing/${source}-${path.basename(chunk.name)}.json`;
    await fs.mkdir(path.join(directory, 'processing'), { recursive: true, mode: 0o700 });
    await this.store.file(directory, 'processing');
    try {
      const segments = JSON.parse(await fs.readFile(await this.store.file(directory, cacheName), 'utf8'));
      if (!Array.isArray(segments) || segments.some(segment => !segment || segment.source !== source || typeof segment.text !== 'string' ||
          segment.speakerId !== (source === 'microphone' ? 'you' : 'system') || !Number.isFinite(segment.start) ||
          !Number.isFinite(segment.end) || segment.start < chunk.start || segment.end < segment.start)) throw new SyntaxError('Invalid cached transcript.');
      return segments;
    }
    catch (error: any) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    const segments = await transcribeRecordingChunk(await this.store.file(directory, chunk.name), source, key, chunk.start);
    await writeRecordingFile(path.join(directory, cacheName), JSON.stringify(segments));
    return segments;
  }

  private async combine(directory: string, source: RecordingSource, chunks: readonly Chunk[]) {
    const list = path.join(directory, 'processing', `${source}.txt`);
    const lines = [];
    for (const chunk of chunks) {
      await this.store.file(directory, chunk.name);
      // Generated relative names keep quotes and newlines in the user's data directory
      // out of the concat manifest's syntax.
      lines.push(`file '../${chunk.name}'`);
    }
    await fs.rm(list, { force: true });
    await fs.writeFile(list, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    const output = path.join(directory, `${source}.flac`);
    await fs.rm(output, { force: true });
    await runAudioCommand(['-nostdin', '-v', 'error', '-n', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'flac', output]);
  }
}
