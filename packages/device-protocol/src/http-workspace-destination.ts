import type {
  WorkspaceRequest,
  WorkspaceUploadSink,
  WorkspaceUploadTicket,
} from './http-workspace-types';

type Upload = {
  sink: WorkspaceUploadSink;
  ticket: WorkspaceUploadTicket;
  start: number;
  offset: number;
  phase: 'staging' | 'retry-upload' | 'commit';
};

/** Owns staging -> upload -> commit, retaining staged bytes until commit succeeds. */
export function createHttpWorkspaceDestination(
  request: WorkspaceRequest,
  createSink: () => Promise<WorkspaceUploadSink>,
) {
  const uploads = new Map<string, Upload>();
  const busy = new Set<string>();

  async function exclusive<T>(
    input: Record<string, unknown>,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = String(input.transferId);
    if (busy.has(key)) throw new Error('Workspace upload operation is already in progress');
    busy.add(key);
    try {
      return await action();
    } finally {
      busy.delete(key);
    }
  }

  async function upload(state: Upload, input: Record<string, unknown>, signal?: AbortSignal) {
    if (state.phase === 'commit') return;
    // Reject an early commit before closing the platform sink or changing its write state.
    if (state.offset !== state.ticket.size) throw new Error('Workspace HTTP upload is incomplete');
    try {
      let offset = state.start;
      if (state.phase === 'retry-upload') {
        const resumed = await request('files.transfer.prepare', input, signal);
        state.ticket = resumed.upload;
        offset = resumed.offset;
      }
      if (!Number.isSafeInteger(offset) || offset < state.start || offset > state.offset)
        throw new Error('Invalid upload resume offset');
      if (offset !== state.ticket.size)
        offset = await state.sink.finish(state.ticket, offset, signal, offset - state.start);
      if (offset !== state.ticket.size) throw new Error('Workspace HTTP upload is incomplete');
      state.phase = 'commit';
    } catch (error) {
      state.phase = 'retry-upload';
      throw error;
    }
  }

  return {
    async createDirectory(path: string, signal?: AbortSignal) {
      await request('files.transfer.mkdir', { path }, signal);
    },
    async prepareFile(input: Record<string, unknown>, signal?: AbortSignal) {
      return exclusive(input, async () => {
        const result = await request('files.transfer.prepare', input, signal);
        const key = String(input.transferId);
        // Allocate first: a platform allocation failure must not discard existing staged bytes.
        const sink = await createSink();
        try {
          await uploads.get(key)?.sink.close();
        } catch (error) {
          await sink.close();
          throw error;
        }
        uploads.set(key, {
          sink,
          ticket: result.upload,
          start: result.offset,
          offset: result.offset,
          phase: 'staging',
        });
        return { offset: result.offset };
      });
    },
    async writeChunk(input: Record<string, unknown>, signal?: AbortSignal) {
      return exclusive(input, async () => {
        signal?.throwIfAborted();
        const state = uploads.get(String(input.transferId));
        if (!state || input.offset !== state.offset)
          throw new Error('Workspace upload offset mismatch');
        if (state.phase !== 'staging')
          throw new Error('Workspace upload is no longer accepting writes');
        const bytes = Uint8Array.from(atob(String(input.dataBase64)), (char) => char.charCodeAt(0));
        if (state.offset + bytes.length > state.ticket.size)
          throw new Error('Workspace upload exceeds declared size');
        await state.sink.write(bytes);
        state.offset += bytes.length;
        return { offset: state.offset };
      });
    },
    async commitFile(input: Record<string, unknown>, signal?: AbortSignal) {
      return exclusive(input, async () => {
        const key = String(input.transferId);
        const state = uploads.get(key);
        if (!state) throw new Error('Workspace upload is not prepared');
        await upload(state, input, signal);
        await request('files.transfer.commit', input, signal);
        await state.sink.close();
        uploads.delete(key);
      });
    },
    async abortFile(input: Record<string, unknown>, signal?: AbortSignal) {
      return exclusive(input, async () => {
        const key = String(input.transferId);
        await uploads.get(key)?.sink.close();
        uploads.delete(key);
        await request('files.transfer.abort', input, signal);
      });
    },
  };
}
