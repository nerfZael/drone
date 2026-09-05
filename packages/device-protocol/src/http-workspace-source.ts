import type { WorkspaceRequest } from './http-workspace-types';

type Download = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  offset: number;
  pending: Uint8Array;
  size: number;
  idle?: ReturnType<typeof setTimeout>;
};

/** One streaming HTTP body per sequential read, with a single cleanup path. */
export function createHttpWorkspaceSource(request: WorkspaceRequest, fetchImpl: typeof fetch) {
  const downloads = new Map<string, Download>();
  const reading = new Set<string>();
  let opening = 0;

  async function release(path: string, state: Download) {
    clearTimeout(state.idle);
    // A stale timer or failed read must never remove a newer download of the same path.
    if (downloads.get(path) === state) downloads.delete(path);
    await state.reader.cancel().catch(() => undefined);
  }

  async function open(path: string, offset: number, signal?: AbortSignal): Promise<Download> {
    if (downloads.size + opening >= 16) throw new Error('Too many workspace downloads');
    opening++;
    try {
      const { download } = await request('files.transfer.read', { path }, signal);
      if (!Number.isSafeInteger(download.size) || download.size < 0 || offset > download.size)
        throw new Error('Invalid workspace download size or offset');
      const response = await fetchImpl(download.url, {
        redirect: 'error',
        signal,
        headers: {
          authorization: `Bearer ${download.token}`,
          ...(offset ? { Range: `bytes=${offset}-` } : {}),
        },
      });
      if (!response.ok || !response.body || (offset && response.status !== 206)) {
        await response.body?.cancel();
        throw new Error('Workspace HTTP download failed');
      }
      const state: Download = {
        reader: response.body.getReader(),
        offset,
        pending: new Uint8Array(),
        size: download.size,
      };
      downloads.set(path, state);
      return state;
    } finally {
      opening--;
    }
  }

  return {
    stat: (path: string, signal?: AbortSignal) => request('files.transfer.stat', { path }, signal),
    list: async (path: string, signal?: AbortSignal) =>
      (await request('files.transfer.list', { path }, signal)).entries,
    async readChunk(path: string, offset: number, length: number, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length <= 0
      )
        throw new Error('Invalid workspace read range');
      if (reading.has(path)) throw new Error('Workspace download is already being read');
      reading.add(path);
      try {
        let state = downloads.get(path);
        if (state && state.offset !== offset) {
          await release(path, state);
          state = undefined;
        }
        state ??= await open(path, offset, signal);
        const current = state;
        const abort = () => {
          void release(path, current);
        };
        signal?.addEventListener('abort', abort, { once: true });
        clearTimeout(state.idle);
        state.idle = setTimeout(() => {
          void release(path, current);
        }, 30_000);
        (state.idle as ReturnType<typeof setTimeout> & { unref?(): void }).unref?.();
        try {
          signal?.throwIfAborted();
          const bytes = new Uint8Array(Math.min(length, Math.max(0, state.size - offset)));
          let used = 0;
          while (used < bytes.length) {
            if (!state.pending.length) {
              const next = await state.reader.read();
              signal?.throwIfAborted();
              if (next.done) throw new Error('Workspace download ended before its declared size');
              state.pending = next.value;
            }
            const count = Math.min(bytes.length - used, state.pending.length);
            bytes.set(state.pending.subarray(0, count), used);
            state.pending = state.pending.subarray(count);
            used += count;
          }
          state.offset += used;
          if (state.offset === state.size) await release(path, state);
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return { dataBase64: btoa(binary), bytes: used };
        } catch (error) {
          await release(path, state);
          throw error;
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      } finally {
        reading.delete(path);
      }
    },
  };
}
