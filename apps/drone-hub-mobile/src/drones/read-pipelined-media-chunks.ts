import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

const MAX_PIPELINED_REQUESTS = 3;

export type ValidatedMediaChunk = {
  bytes: Uint8Array;
  snapshotToken?: string;
  done?: boolean;
};

type PipelinedMediaInput<Result> = {
  firstResult: Result;
  totalBytes: number;
  requestResult: (offset: number, snapshotToken?: string) => Promise<Result>;
  validateResult: (result: Result, offset: number) => ValidatedMediaChunk;
  appendBytes: (bytes: Uint8Array) => void;
  isCancelled?: () => boolean;
  cancelSnapshot?: (snapshotToken: string) => Promise<void>;
};

export async function readPipelinedMediaChunks<Result>(
  input: PipelinedMediaInput<Result>,
): Promise<void> {
  const first = input.validateResult(input.firstResult, 0);
  validateChunkBounds(first, 0, input.totalBytes);
  try {
    ensureActive(input.isCancelled);
    input.appendBytes(first.bytes);
    if (first.bytes.length === input.totalBytes) return;
    if (first.snapshotToken && first.bytes.length === MESH_BINARY_CHUNK_BYTES) {
      await readPipelined(input, first.snapshotToken, first.bytes.length);
      return;
    }
    await readSequential(input, first.snapshotToken, first.bytes.length);
  } catch (error) {
    if (first.snapshotToken) {
      void input.cancelSnapshot?.(first.snapshotToken).catch(() => undefined);
    }
    throw error;
  }
}

async function readSequential<Result>(
  input: PipelinedMediaInput<Result>,
  initialToken: string | undefined,
  initialOffset: number,
) {
  let snapshotToken = initialToken;
  let offset = initialOffset;
  while (offset < input.totalBytes) {
    ensureActive(input.isCancelled);
    const next = input.validateResult(await input.requestResult(offset, snapshotToken), offset);
    validateChunkBounds(next, offset, input.totalBytes);
    ensureActive(input.isCancelled);
    if (snapshotToken && next.snapshotToken !== snapshotToken) {
      throw new Error('The remote media snapshot changed while it was loading');
    }
    snapshotToken ??= next.snapshotToken;
    input.appendBytes(next.bytes);
    offset += next.bytes.length;
  }
}

async function readPipelined<Result>(
  input: PipelinedMediaInput<Result>,
  snapshotToken: string,
  initialOffset: number,
) {
  type Settled = { ok: true; result: Result } | { ok: false; error: unknown };
  const pending = new Map<number, Promise<Settled>>();
  let nextRequestOffset = initialOffset;
  let nextWriteOffset = initialOffset;
  const schedule = () => {
    while (
      pending.size < MAX_PIPELINED_REQUESTS &&
      nextRequestOffset < input.totalBytes &&
      !input.isCancelled?.()
    ) {
      const offset = nextRequestOffset;
      nextRequestOffset += MESH_BINARY_CHUNK_BYTES;
      pending.set(
        offset,
        input.requestResult(offset, snapshotToken).then(
          (result) => ({ ok: true, result }),
          (error) => ({ ok: false, error }),
        ),
      );
    }
  };

  schedule();
  try {
    while (nextWriteOffset < input.totalBytes) {
      ensureActive(input.isCancelled);
      const request = pending.get(nextWriteOffset);
      if (!request) throw new Error('The remote media pipeline lost a chunk');
      const settled = await request;
      pending.delete(nextWriteOffset);
      ensureActive(input.isCancelled);
      if (!settled.ok) throw settled.error;
      const chunk = input.validateResult(settled.result, nextWriteOffset);
      validateChunkBounds(chunk, nextWriteOffset, input.totalBytes);
      if (chunk.snapshotToken !== snapshotToken) {
        throw new Error('The remote media snapshot changed while it was loading');
      }
      const expectedBytes = Math.min(MESH_BINARY_CHUNK_BYTES, input.totalBytes - nextWriteOffset);
      if (chunk.bytes.length !== expectedBytes) {
        throw new Error('The selected device returned an invalid media chunk');
      }
      input.appendBytes(chunk.bytes);
      nextWriteOffset += chunk.bytes.length;
      schedule();
    }
  } catch (error) {
    await Promise.all([...pending.values()]);
    throw error;
  }
}

function validateChunkBounds(chunk: ValidatedMediaChunk, offset: number, totalBytes: number) {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 0 ||
    chunk.bytes.length === 0 ||
    chunk.bytes.length > totalBytes - offset ||
    (chunk.done === true) !== (offset + chunk.bytes.length === totalBytes)
  ) {
    throw new Error('The selected device returned an invalid media chunk');
  }
}

function ensureActive(isCancelled: (() => boolean) | undefined) {
  if (isCancelled?.()) throw new Error('The media load was cancelled');
}
