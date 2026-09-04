import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';
import { toByteArray } from 'base64-js';

const MAX_MESH_JSON_CONTENT_BYTES = 32 * 1024 * 1024;
const MAX_PIPELINED_REQUESTS = 3;

type MeshContentChunk = {
  encoding?: unknown;
  offset?: unknown;
  bytes?: unknown;
  totalBytes?: unknown;
  done?: unknown;
  dataBase64?: unknown;
  snapshotToken?: unknown;
};

type ReadMeshJsonOptions = {
  isCancelled?: () => boolean;
  signal?: AbortSignal;
  cancelSnapshot?: (snapshotToken: string) => Promise<void>;
};

type RequestChunk = (
  offset: number,
  snapshotToken?: string,
  signal?: AbortSignal,
) => Promise<MeshContentChunk>;

export async function readMeshJsonContent(
  requestChunk: RequestChunk,
  options: ReadMeshJsonOptions = {},
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await readMeshJsonContentOnce(requestChunk, options);
    } catch (error) {
      ensureActive(options);
      if (attempt > 0 || !isExpiredTransfer(error)) throw error;
    }
  }
  throw new Error('The remote content transfer could not be restarted');
}

async function readMeshJsonContentOnce(
  requestChunk: RequestChunk,
  options: ReadMeshJsonOptions,
): Promise<any> {
  const controller = new AbortController();
  const removeAbortListener = forwardAbort(options.signal, controller);
  let first: ValidatedChunk | null = null;
  try {
    first = validateChunk(await requestChunk(0, undefined, controller.signal), 0, null, undefined);
    ensureActive(options);
    if (first.done) return decodeJson([first.bytes], first.totalBytes);

    if (
      first.snapshotToken &&
      first.bytes.length === MESH_BINARY_CHUNK_BYTES &&
      first.totalBytes > first.bytes.length
    ) {
      return await readPipelined(requestChunk, first, options, controller);
    }
    return await readSequential(requestChunk, first, options, controller.signal);
  } catch (error) {
    controller.abort();
    if (first?.snapshotToken) {
      void options.cancelSnapshot?.(first.snapshotToken).catch(() => undefined);
    }
    throw error;
  } finally {
    removeAbortListener();
  }
}

async function readSequential(
  requestChunk: RequestChunk,
  first: ValidatedChunk,
  options: ReadMeshJsonOptions,
  signal: AbortSignal,
) {
  const chunks = [first.bytes];
  let offset = first.bytes.length;
  let snapshotToken = first.snapshotToken;
  for (let index = 1; index < 1_024; index += 1) {
    ensureActive(options);
    const next = validateChunk(
      await requestChunk(offset, snapshotToken, signal),
      offset,
      first.totalBytes,
      snapshotToken,
    );
    ensureActive(options);
    snapshotToken ??= next.snapshotToken;
    chunks.push(next.bytes);
    offset += next.bytes.length;
    if (next.done) return decodeJson(chunks, first.totalBytes);
  }
  throw new Error('The remote content used too many chunks');
}

async function readPipelined(
  requestChunk: RequestChunk,
  first: ValidatedChunk,
  options: ReadMeshJsonOptions,
  controller: AbortController,
) {
  const chunkCount = Math.ceil(first.totalBytes / MESH_BINARY_CHUNK_BYTES);
  if (chunkCount > 1_024) throw new Error('The remote content used too many chunks');
  const chunks = new Array<Uint8Array>(chunkCount);
  chunks[0] = first.bytes;
  let nextIndex = 1;
  let stopped = false;
  const worker = async () => {
    try {
      while (!stopped && nextIndex < chunkCount) {
        ensureActive(options);
        const index = nextIndex;
        nextIndex += 1;
        const offset = index * MESH_BINARY_CHUNK_BYTES;
        const chunk = validateChunk(
          await requestChunk(offset, first.snapshotToken, controller.signal),
          offset,
          first.totalBytes,
          first.snapshotToken,
        );
        ensureActive(options);
        const expectedBytes = Math.min(MESH_BINARY_CHUNK_BYTES, first.totalBytes - offset);
        if (chunk.bytes.length !== expectedBytes || chunk.done !== (index === chunkCount - 1)) {
          throw new Error('The remote device returned an invalid content chunk');
        }
        chunks[index] = chunk.bytes;
      }
    } catch (error) {
      stopped = true;
      controller.abort();
      throw error;
    }
  };
  const workers = Array.from({ length: Math.min(MAX_PIPELINED_REQUESTS, chunkCount - 1) }, () =>
    worker(),
  );
  try {
    await Promise.all(workers);
  } catch (error) {
    controller.abort();
    void Promise.allSettled(workers);
    throw error;
  }
  return decodeJson(chunks, first.totalBytes);
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

type ValidatedChunk = {
  bytes: Uint8Array;
  totalBytes: number;
  done: boolean;
  snapshotToken?: string;
};

function validateChunk(
  chunk: MeshContentChunk,
  offset: number,
  expectedTotal: number | null,
  expectedToken: string | undefined,
): ValidatedChunk {
  if (chunk?.encoding !== 'base64-json-utf8' || Number(chunk?.offset) !== offset) {
    throw new Error('The remote device returned an invalid content chunk');
  }
  const bytes = toByteArray(String(chunk?.dataBase64 ?? ''));
  if (bytes.length === 0 && chunk?.done !== true) {
    throw new Error('The remote device returned an empty content chunk');
  }
  if (Number(chunk?.bytes) !== bytes.length) {
    throw new Error('The remote content chunk size did not match');
  }
  const totalBytes = Number(chunk?.totalBytes);
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < offset + bytes.length ||
    totalBytes > MAX_MESH_JSON_CONTENT_BYTES
  ) {
    throw new Error('The remote content length was invalid');
  }
  if (expectedTotal !== null && totalBytes !== expectedTotal) {
    throw new Error('The remote content changed while it was loading');
  }
  const snapshotToken =
    typeof chunk?.snapshotToken === 'string' && chunk.snapshotToken.trim()
      ? chunk.snapshotToken.trim()
      : undefined;
  if (expectedToken && snapshotToken !== expectedToken) {
    throw new Error('The remote content snapshot changed while it was loading');
  }
  if (chunk?.done === true && offset + bytes.length !== totalBytes) {
    throw new Error('The remote content ended early');
  }
  return { bytes, totalBytes, done: chunk?.done === true, snapshotToken };
}

function decodeJson(chunks: Uint8Array[], totalBytes: number) {
  const combined = new Uint8Array(totalBytes);
  let position = 0;
  for (const part of chunks) {
    combined.set(part, position);
    position += part.length;
  }
  if (position !== totalBytes) throw new Error('The remote content ended early');
  return JSON.parse(new TextDecoder().decode(combined));
}

function ensureActive(options: ReadMeshJsonOptions) {
  if (options.signal?.aborted || options.isCancelled?.()) {
    throw new Error('The content load was cancelled');
  }
}

function isExpiredTransfer(error: unknown): boolean {
  return String((error as any)?.code ?? '') === 'TRANSFER_EXPIRED';
}
