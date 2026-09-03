import crypto from 'node:crypto';

import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

export type MeshSnapshotChunk = {
  encoding: 'base64-json-utf8' | 'base64-binary';
  offset: number;
  bytes: number;
  totalBytes: number;
  done: boolean;
  dataBase64: string;
  snapshotToken?: string;
};

type Snapshot = {
  content: Buffer;
  encoding: MeshSnapshotChunk['encoding'];
  sourceDeviceId: string;
  scope: string;
  metadata: unknown;
  expiresAt: number;
  createdAt: number;
};

type SnapshotStoreOptions = {
  maxSnapshotBytes?: number;
  maxTotalBytes?: number;
  ttlMs?: number;
  now?: () => number;
  createToken?: () => string;
};

const DEFAULT_MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_TTL_MS = 60_000;

export class MeshContentSnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly maxSnapshotBytes: number;
  private readonly maxTotalBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly createToken: () => string;
  private totalBytes = 0;
  private reservedBytes = 0;
  private closed = false;

  constructor(options: SnapshotStoreOptions = {}) {
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ?? (() => crypto.randomUUID());
  }

  createJson(input: {
    value: unknown;
    sourceDeviceId: string;
    scope: string;
    offset?: unknown;
  }): MeshSnapshotChunk {
    this.ensureOpen();
    return this.create({
      content: Buffer.from(JSON.stringify(input.value)),
      encoding: 'base64-json-utf8',
      sourceDeviceId: input.sourceDeviceId,
      scope: input.scope,
      offset: input.offset,
    }).chunk;
  }

  createBinary(input: {
    content: Buffer;
    sourceDeviceId: string;
    scope: string;
    metadata?: unknown;
    offset?: unknown;
  }): { chunk: MeshSnapshotChunk; metadata: unknown } {
    this.ensureOpen();
    return this.create({
      ...input,
      encoding: 'base64-binary',
    });
  }

  resume(input: {
    snapshotToken: unknown;
    sourceDeviceId: string;
    scope: string;
    encoding: MeshSnapshotChunk['encoding'];
    offset: unknown;
  }): { chunk: MeshSnapshotChunk; metadata: unknown } {
    this.ensureOpen();
    const token = String(input.snapshotToken ?? '').trim();
    this.pruneExpired();
    const snapshot = this.snapshots.get(token);
    if (!snapshot) throw transferError('The transfer snapshot expired', 'TRANSFER_EXPIRED');
    if (
      snapshot.sourceDeviceId !== input.sourceDeviceId ||
      snapshot.scope !== input.scope ||
      snapshot.encoding !== input.encoding
    ) {
      throw transferError('The transfer snapshot does not match this request', 'INVALID_REQUEST');
    }
    return {
      chunk: snapshotChunk(snapshot.content, input.offset, snapshot.encoding, token, true),
      metadata: snapshot.metadata,
    };
  }

  revokeDevice(sourceDeviceId: string) {
    for (const [token, snapshot] of this.snapshots) {
      if (snapshot.sourceDeviceId === sourceDeviceId) this.remove(token, snapshot);
    }
  }

  reserve(contentBytes: number): () => void {
    this.ensureOpen();
    this.pruneExpired();
    if (
      !Number.isSafeInteger(contentBytes) ||
      contentBytes < 0 ||
      contentBytes > this.maxSnapshotBytes
    ) {
      throw transferError('The transfer is too large to snapshot', 'RESOURCE_LIMIT');
    }
    this.evictUntilAvailable(contentBytes);
    if (this.totalBytes + this.reservedBytes + contentBytes > this.maxTotalBytes) {
      throw transferError('The transfer snapshot limit is full', 'RESOURCE_LIMIT');
    }
    this.reservedBytes += contentBytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reservedBytes -= contentBytes;
    };
  }

  clear() {
    this.snapshots.clear();
    this.totalBytes = 0;
  }

  close() {
    this.closed = true;
    this.clear();
  }

  get size() {
    this.pruneExpired();
    return this.snapshots.size;
  }

  private create(input: {
    content: Buffer;
    encoding: MeshSnapshotChunk['encoding'];
    sourceDeviceId: string;
    scope: string;
    metadata?: unknown;
    offset?: unknown;
  }): { chunk: MeshSnapshotChunk; metadata: unknown } {
    this.pruneExpired();
    if (input.content.length > this.maxSnapshotBytes) {
      throw transferError('The transfer is too large to snapshot', 'RESOURCE_LIMIT');
    }
    const needsSnapshot = input.content.length > MESH_BINARY_CHUNK_BYTES;
    let token: string | undefined;
    if (needsSnapshot) {
      this.evictUntilAvailable(input.content.length);
      if (this.totalBytes + this.reservedBytes + input.content.length > this.maxTotalBytes) {
        throw transferError('The transfer snapshot limit is full', 'RESOURCE_LIMIT');
      }
      token = this.createToken();
      const now = this.now();
      this.snapshots.set(token, {
        content: input.content,
        encoding: input.encoding,
        sourceDeviceId: input.sourceDeviceId,
        scope: input.scope,
        metadata: input.metadata,
        expiresAt: now + this.ttlMs,
        createdAt: now,
      });
      this.totalBytes += input.content.length;
    }
    return {
      chunk: snapshotChunk(input.content, input.offset, input.encoding, token, false),
      metadata: input.metadata,
    };
  }

  private pruneExpired() {
    const now = this.now();
    for (const [token, snapshot] of this.snapshots) {
      if (snapshot.expiresAt <= now) this.remove(token, snapshot);
    }
  }

  private evictUntilAvailable(contentBytes: number) {
    while (
      this.snapshots.size > 0 &&
      this.totalBytes + this.reservedBytes + contentBytes > this.maxTotalBytes
    ) {
      const oldest = [...this.snapshots.entries()].reduce((current, candidate) =>
        candidate[1].createdAt < current[1].createdAt ? candidate : current,
      );
      this.remove(oldest[0], oldest[1]);
    }
  }

  private remove(token: string, snapshot: Snapshot) {
    if (!this.snapshots.delete(token)) return;
    this.totalBytes -= snapshot.content.length;
  }

  private ensureOpen() {
    if (this.closed) throw transferError('The transfer store is closed', 'CAPABILITY_CLOSED');
  }
}

function snapshotChunk(
  content: Buffer,
  offsetRaw: unknown,
  encoding: MeshSnapshotChunk['encoding'],
  snapshotToken: string | undefined,
  strictOffset: boolean,
): MeshSnapshotChunk {
  const parsedOffset = Number(offsetRaw ?? 0);
  if (
    strictOffset &&
    (!Number.isSafeInteger(parsedOffset) || parsedOffset < 0 || parsedOffset >= content.length)
  ) {
    throw transferError('The transfer offset is outside the snapshot', 'INVALID_REQUEST');
  }
  const offset =
    Number.isSafeInteger(parsedOffset) && parsedOffset > 0
      ? Math.min(parsedOffset, content.length)
      : 0;
  const chunk = content.subarray(offset, offset + MESH_BINARY_CHUNK_BYTES);
  return {
    encoding,
    offset,
    bytes: chunk.length,
    totalBytes: content.length,
    done: offset + chunk.length >= content.length,
    dataBase64: chunk.toString('base64'),
    ...(snapshotToken ? { snapshotToken } : {}),
  };
}

function transferError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}
