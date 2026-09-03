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
};

export async function readMeshJsonContent(
  requestChunk: (offset: number, snapshotToken?: string) => Promise<MeshContentChunk>,
  options: ReadMeshJsonOptions = {},
): Promise<any> {
  const first = validateChunk(await requestChunk(0), 0, null, undefined);
  ensureActive(options);
  if (first.done) return decodeJson([first.bytes], first.totalBytes);

  if (
    first.snapshotToken &&
    first.bytes.length === MESH_BINARY_CHUNK_BYTES &&
    first.totalBytes > first.bytes.length
  ) {
    return await readPipelined(requestChunk, first, options);
  }
  return await readSequential(requestChunk, first, options);
}

async function readSequential(
  requestChunk: (offset: number, snapshotToken?: string) => Promise<MeshContentChunk>,
  first: ValidatedChunk,
  options: ReadMeshJsonOptions,
) {
  const chunks = [first.bytes];
  let offset = first.bytes.length;
  let snapshotToken = first.snapshotToken;
  for (let index = 1; index < 1_024; index += 1) {
    ensureActive(options);
    const next = validateChunk(
      await requestChunk(offset, snapshotToken),
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
  requestChunk: (offset: number, snapshotToken?: string) => Promise<MeshContentChunk>,
  first: ValidatedChunk,
  options: ReadMeshJsonOptions,
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
          await requestChunk(offset, first.snapshotToken),
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
      throw error;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_PIPELINED_REQUESTS, chunkCount - 1) }, () => worker()),
  );
  return decodeJson(chunks, first.totalBytes);
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
  if (options.isCancelled?.()) throw new Error('The content load was cancelled');
}
