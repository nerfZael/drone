import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { RecordingSegment, RecordingSource } from '@drone/hub-model';
import { transcribeAudioWithGroq } from '../groq-transcription';

export async function runAudioCommand(args: string[], command = 'ffmpeg'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15 * 60_000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-64_000); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} failed: ${errors || `exit ${code}`}`));
    });
  });
}

export async function audioDuration(file: string) {
  const result = Number(await runAudioCommand(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], 'ffprobe'));
  if (!Number.isFinite(result) || result < 0) throw new Error('Could not determine recording duration.');
  return result;
}

export async function transcribeRecordingChunk(file: string, source: RecordingSource, apiKey: string, offset = 0): Promise<RecordingSegment[]> {
  const bytes = await fs.readFile(file);
  const result = await transcribeAudioWithGroq({ audio: bytes, mimeType: 'audio/flac', apiKey, segmentTimestamps: true, signal: AbortSignal.timeout(180_000) });
  return (result.segments ?? []).map(segment => ({ ...segment, start: segment.start + offset, end: segment.end + offset, source, speakerId: source === 'microphone' ? 'you' : 'system' }));
}

export async function diarizeRecording(file: string, apiKey: string): Promise<Array<{ start: number; end: number; text: string; speaker: string }>> {
  const stat = await fs.stat(file);
  if (stat.size > 24_000_000) throw new Error('The diarization upload exceeds 24 MB. Original audio is retained for retry.');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await fs.readFile(file))], { type: 'audio/mpeg' }), 'system.mp3');
  form.append('model', 'gpt-4o-transcribe-diarize');
  form.append('response_format', 'diarized_json');
  form.append('chunking_strategy', 'auto');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(15 * 60_000),
  });
  const result: any = await response.json().catch(() => null);
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id');
    const detail = typeof result?.error?.message === 'string' ? result.error.message.trim() : '';
    throw Object.assign(new Error(`OpenAI transcription failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''})${detail && detail !== response.statusText ? `: ${detail}` : ''}${requestId ? ` [request ID: ${requestId}]` : ''}`), { status: response.status });
  }
  return parseDiarizedSegments(result?.segments);
}

export function parseDiarizedSegments(value: unknown): Array<{ start: number; end: number; text: string; speaker: string }> {
  if (!Array.isArray(value)) throw new SyntaxError('No diarized speaker segments were returned.');
  return value.map((segment: any) => {
    if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start || typeof segment.text !== 'string' || typeof segment.speaker !== 'string') {
      throw new SyntaxError('Invalid diarized speaker segment.');
    }
    return { start: segment.start, end: segment.end, text: segment.text.trim(), speaker: segment.speaker };
  }).filter((segment: { text: string }) => segment.text);
}

export function mergeRecordingSegments(microphone: RecordingSegment[], system: RecordingSegment[]): RecordingSegment[] {
  // Keep overlap: two people can speak simultaneously. Track separation does not establish
  // whether similar words are echo or two distinct utterances, so never discard them heuristically.
  return [...microphone, ...system].sort((a, b) => a.start - b.start || a.end - b.end || a.source.localeCompare(b.source));
}
