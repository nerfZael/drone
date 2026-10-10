import { requestJson } from '../http';
import { checkHtmlCopySize } from './html-preview-limits';

type HtmlChunk =
  | { ok: true; dataBase64: string; offset: number; nextOffset: number; eof: boolean }
  | { ok: false; error: string };

/** Decode bytes across chunk boundaries so UTF-8 characters remain intact. */
export async function readLargeHtmlSource(droneId: string, path: string, signal: AbortSignal, size?: number | null): Promise<string> {
  signal.throwIfAborted();
  checkHtmlCopySize(size ?? 0);
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let offset = 0;
  while (true) {
    signal.throwIfAborted();
    const chunk = await requestJson<HtmlChunk>(
      `/api/drones/${encodeURIComponent(droneId)}/fs/chunk?path=${encodeURIComponent(path)}&offset=${offset}&limit=${512 * 1024}`,
      { signal },
    );
    signal.throwIfAborted();
    if (!chunk.ok) throw new Error(chunk.error);
    // Check before decoding/retaining bytes, including when metadata was stale.
    checkHtmlCopySize(offset + Math.floor(chunk.dataBase64.length / 4) * 3 - (chunk.dataBase64.endsWith('==') ? 2 : chunk.dataBase64.endsWith('=') ? 1 : 0));
    const bytes = Uint8Array.from(atob(chunk.dataBase64), char => char.charCodeAt(0));
    if (chunk.offset !== offset || chunk.nextOffset !== offset + bytes.length || (!chunk.eof && bytes.length === 0)) {
      throw new Error('Could not load the complete HTML file: invalid file chunk.');
    }
    parts.push(decoder.decode(bytes, { stream: true }));
    if (chunk.eof) break;
    offset = chunk.nextOffset;
  }
  parts.push(decoder.decode());
  return parts.join('');
}
