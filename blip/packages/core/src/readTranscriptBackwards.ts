import { open } from 'node:fs/promises';
import type { TranscriptEntry } from './types.js';

/** Read a snapshot of JSONL from its end without decoding the compacted prefix. */
export async function* readTranscriptBackwards(filename: string): AsyncGenerator<TranscriptEntry> {
  const file = await open(filename, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!file) return;
  try {
    let position = (await file.stat()).size;
    let parts: Buffer[] = [];
    while (position > 0) {
      const size = Math.min(position, 64 * 1024);
      position -= size;
      const buffer = Buffer.allocUnsafe(size);
      const { bytesRead } = await file.read(buffer, 0, size, position);
      if (bytesRead !== size) throw new Error('Transcript changed while reading');
      let end = size;
      for (let index = size - 1; index >= 0; index -= 1) {
        if (buffer[index] !== 10) continue;
        parts.push(buffer.subarray(index + 1, end));
        const line = Buffer.concat(parts.reverse()).toString('utf8').trim();
        parts = [];
        if (line) yield JSON.parse(line) as TranscriptEntry;
        end = index;
      }
      if (end > 0) parts.push(buffer.subarray(0, end));
    }
    const line = Buffer.concat(parts.reverse()).toString('utf8').trim();
    if (line) yield JSON.parse(line) as TranscriptEntry;
  } finally {
    await file.close();
  }
}
