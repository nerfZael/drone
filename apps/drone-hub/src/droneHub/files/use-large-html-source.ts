import React from 'react';
import { requestJson } from '../http';
import { checkHtmlPreviewSize, HtmlPreviewTooLargeError } from './html-preview-limits';

type HtmlChunk =
  | { ok: true; dataBase64: string; offset: number; nextOffset: number; eof: boolean }
  | { ok: false; error: string };

/** Decode bytes across chunk boundaries so UTF-8 characters remain intact. */
export async function readLargeHtmlSource(droneId: string, path: string, signal: AbortSignal, size?: number | null): Promise<string> {
  signal.throwIfAborted();
  checkHtmlPreviewSize(size ?? 0);
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
    checkHtmlPreviewSize(offset + Math.floor(chunk.dataBase64.length / 4) * 3 - (chunk.dataBase64.endsWith('==') ? 2 : chunk.dataBase64.endsWith('=') ? 1 : 0));
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

export function useLargeHtmlSource(input: { enabled: boolean; droneId: string; path: string; revision?: string | null; size?: number | null }) {
  const { enabled, droneId, path, revision, size } = input;
  const fileKey = JSON.stringify([droneId, path]);
  const [retrySeq, setRetrySeq] = React.useState(0);
  const [state, setState] = React.useState<{
    fileKey: string; source: string | null; error: string | null; tooLarge?: boolean;
  } | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState(previous => ({ fileKey, source: previous?.fileKey === fileKey ? previous.source : null, error: null }));
    void readLargeHtmlSource(droneId, path, controller.signal, size)
      .then(source => {
        if (!controller.signal.aborted) setState({ fileKey, source, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted) setState(previous => ({
          fileKey, source: previous?.fileKey === fileKey ? previous.source : null,
          error: String(error?.message ?? error),
          tooLarge: error instanceof HtmlPreviewTooLargeError,
        }));
      });
    return () => controller.abort();
  }, [enabled, droneId, path, fileKey, revision, size, retrySeq]);
  const current = state?.fileKey === fileKey ? state : null;
  return {
    source: current?.source ?? null,
    error: current?.error ?? null,
    tooLarge: current?.tooLarge ?? false,
    loading: enabled && current?.source == null && !current?.error,
    retry: React.useCallback(() => setRetrySeq(seq => seq + 1), []),
  };
}
