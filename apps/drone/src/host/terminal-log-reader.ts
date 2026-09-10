import fs from 'node:fs/promises';

// Keep file cursors in bytes while returning only complete UTF-8 sequences.
// Reading up to three extra bytes lets even max=1 make forward progress.
export async function readTerminalLogChunk(
  logPath: string,
  sinceRaw: number,
  maxRaw: number,
): Promise<{ chunk: string; nextOffset: number }> {
  const max = Math.max(1, Math.min(1024 * 1024, Math.floor(maxRaw || 65536)));
  const handle = await fs.open(logPath, 'r').catch(() => null);
  if (!handle) return { chunk: '', nextOffset: 0 };
  try {
    const { size } = await handle.stat();
    const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.floor(sinceRaw) : 0;
    const offset = Math.min(since, size);
    const buffer = Buffer.alloc(Math.min(max + 3, Math.max(0, size - offset)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    let end = Math.min(max, bytesRead);
    while (end < bytesRead && (buffer[end] & 0xc0) === 0x80) end++;
    // A producer can have written just the first bytes of a character. Wait
    // for the remaining bytes instead of replacing them and advancing past it.
    let lastStart = end - 1;
    while (lastStart >= 0 && (buffer[lastStart] & 0xc0) === 0x80) lastStart--;
    if (lastStart >= 0) {
      const lead = buffer[lastStart];
      const length =
        lead >= 0xf0 && lead <= 0xf4
          ? 4
          : lead >= 0xe0 && lead <= 0xef
            ? 3
            : lead >= 0xc2 && lead <= 0xdf
              ? 2
              : 1;
      if (end - lastStart < length) end = lastStart;
    }
    return { chunk: buffer.subarray(0, end).toString('utf8'), nextOffset: offset + end };
  } finally {
    await handle.close();
  }
}
