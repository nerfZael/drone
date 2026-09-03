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

export type MeshSnapshotReservation = {
  signal: AbortSignal;
  commitBinary(input: { content: Buffer; scope: string; metadata?: unknown; offset?: unknown }): {
    chunk: MeshSnapshotChunk;
    metadata: unknown;
  };
  release(): void;
};

type Snapshot = {
  content: Buffer;
  encoding: MeshSnapshotChunk['encoding'];
  sourceDeviceId: string;
  scope: string;
  metadata: unknown;
  expiresAt: number;
  deliveredOffsets: Set<number>;
};

type SnapshotStoreOptions = {
  maxSnapshotBytes?: number;
  maxTotalBytes?: number;
  maxSourceBytes?: number;
  ttlMs?: number;
  reservationTtlMs?: number;
  maxPendingReservations?: number;
  now?: () => number;
  createToken?: () => string;
};

type ReservationRequest = {
  id: number;
  sourceDeviceId: string;
  contentBytes: number;
  contentRetained: boolean;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
  resolve: (reservation: MeshSnapshotReservation) => void;
  reject: (error: Error) => void;
};

const DEFAULT_MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_RESERVATION_TTL_MS = 20_000;
const DEFAULT_MAX_PENDING_RESERVATIONS = 100;

export class MeshContentSnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly reservations = new Map<number, ReservationRequest>();
  private readonly pendingReservations: ReservationRequest[] = [];
  private readonly maxSnapshotBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxSourceBytes: number;
  private readonly ttlMs: number;
  private readonly reservationTtlMs: number;
  private readonly maxPendingReservations: number;
  private readonly now: () => number;
  private readonly createToken: () => string;
  private totalBytes = 0;
  private reservedBytes = 0;
  private pendingContentBytes = 0;
  private readonly sourceBytes = new Map<string, number>();
  private readonly sourceReservedBytes = new Map<string, number>();
  private readonly sourcePendingContentBytes = new Map<string, number>();
  private nextReservationId = 1;
  private closed = false;
  private clearing = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SnapshotStoreOptions = {}) {
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.maxSourceBytes =
      options.maxSourceBytes ??
      Math.min(
        this.maxTotalBytes,
        Math.max(this.maxSnapshotBytes, Math.floor(this.maxTotalBytes / 2)),
      );
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.reservationTtlMs = options.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
    this.maxPendingReservations =
      options.maxPendingReservations ?? DEFAULT_MAX_PENDING_RESERVATIONS;
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ?? (() => crypto.randomUUID());
  }

  async createJson(input: {
    value: unknown;
    sourceDeviceId: string;
    scope: string;
    offset?: unknown;
    signal?: AbortSignal;
  }): Promise<MeshSnapshotChunk> {
    this.ensureOpen();
    const content = Buffer.from(JSON.stringify(input.value));
    if (content.length <= MESH_BINARY_CHUNK_BYTES) {
      return snapshotChunk(content, input.offset, 'base64-json-utf8', undefined, false);
    }
    const reservation = await this.reserve(
      input.sourceDeviceId,
      content.length,
      input.signal,
      true,
    );
    try {
      return this.commitReservation(reservation, {
        content,
        encoding: 'base64-json-utf8',
        scope: input.scope,
        offset: input.offset,
      }).chunk;
    } finally {
      reservation.release();
    }
  }

  async createBinary(input: {
    content: Buffer;
    sourceDeviceId: string;
    scope: string;
    metadata?: unknown;
    offset?: unknown;
    signal?: AbortSignal;
  }): Promise<{ chunk: MeshSnapshotChunk; metadata: unknown }> {
    this.ensureOpen();
    const reservation = await this.reserve(
      input.sourceDeviceId,
      input.content.length,
      input.signal,
    );
    try {
      return this.commitReservation(reservation, { ...input, encoding: 'base64-binary' });
    } finally {
      reservation.release();
    }
  }

  async reserve(
    sourceDeviceId: string,
    contentBytes: number,
    signal?: AbortSignal,
    contentRetained = false,
  ): Promise<MeshSnapshotReservation> {
    this.ensureOpen();
    this.pruneExpired();
    this.validateReservationSize(contentBytes);
    if (signal?.aborted) {
      return Promise.reject(transferError('The transfer was cancelled', 'TRANSFER_CANCELLED'));
    }
    if (this.pendingReservations.length >= this.maxPendingReservations) {
      return Promise.reject(transferError('The transfer queue is full', 'RESOURCE_LIMIT'));
    }
    if (
      contentRetained &&
      (this.totalBytes + this.reservedBytes + this.pendingContentBytes + contentBytes >
        this.maxTotalBytes ||
        this.sourceUsage(sourceDeviceId) + contentBytes > this.maxSourceBytes)
    ) {
      return Promise.reject(transferError('The transfer snapshot limit is full', 'RESOURCE_LIMIT'));
    }

    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const id = this.nextReservationId++;
      const onAbort = () => this.cancelReservation(id, 'The transfer was cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => this.cancelReservation(id, 'The transfer reservation expired'),
        this.reservationTtlMs + 5_000,
      );
      timer.unref?.();
      const request: ReservationRequest = {
        id,
        sourceDeviceId,
        contentBytes,
        contentRetained,
        controller,
        timer,
        removeAbortListener: () => signal?.removeEventListener('abort', onAbort),
        resolve,
        reject,
      };
      if (contentRetained) {
        this.pendingContentBytes += contentBytes;
        this.adjustSourceBytes(this.sourcePendingContentBytes, sourceDeviceId, contentBytes);
      }
      this.pendingReservations.push(request);
      this.drainReservations();
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
    const chunk = snapshotChunk(snapshot.content, input.offset, snapshot.encoding, token, true);
    snapshot.deliveredOffsets.add(chunk.offset);
    if (
      snapshot.deliveredOffsets.size >= Math.ceil(snapshot.content.length / MESH_BINARY_CHUNK_BYTES)
    ) {
      this.remove(token, snapshot);
      this.scheduleExpiry();
      this.drainReservations();
    }
    return { chunk, metadata: snapshot.metadata };
  }

  revokeDevice(sourceDeviceId: string): void {
    for (const [token, snapshot] of this.snapshots) {
      if (snapshot.sourceDeviceId === sourceDeviceId) this.remove(token, snapshot);
    }
    for (const request of [...this.reservations.values(), ...this.pendingReservations]) {
      if (request.sourceDeviceId === sourceDeviceId) {
        this.cancelReservation(request.id, 'Transfer access was removed');
      }
    }
    this.scheduleExpiry();
    this.drainReservations();
  }

  cancel(input: { snapshotToken: unknown; sourceDeviceId: string; scope: string }): void {
    this.ensureOpen();
    const token = String(input.snapshotToken ?? '').trim();
    this.pruneExpired();
    const snapshot = this.snapshots.get(token);
    if (!snapshot) return;
    if (snapshot.sourceDeviceId !== input.sourceDeviceId || snapshot.scope !== input.scope) {
      throw transferError('The transfer snapshot does not match this request', 'INVALID_REQUEST');
    }
    this.remove(token, snapshot);
    this.scheduleExpiry();
    this.drainReservations();
  }

  clear(): void {
    this.clearing = true;
    this.snapshots.clear();
    this.totalBytes = 0;
    this.sourceBytes.clear();
    for (const request of [...this.reservations.values(), ...this.pendingReservations]) {
      this.cancelReservation(request.id, 'The transfer store was cleared');
    }
    this.reservations.clear();
    this.pendingReservations.length = 0;
    this.reservedBytes = 0;
    this.pendingContentBytes = 0;
    this.sourceReservedBytes.clear();
    this.sourcePendingContentBytes.clear();
    this.clearing = false;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  close(): void {
    this.closed = true;
    this.clear();
  }

  get size(): number {
    this.pruneExpired();
    return this.snapshots.size;
  }

  private commitReservation(
    reservation: MeshSnapshotReservation,
    input: {
      content: Buffer;
      encoding: MeshSnapshotChunk['encoding'];
      scope: string;
      metadata?: unknown;
      offset?: unknown;
    },
  ): { chunk: MeshSnapshotChunk; metadata: unknown } {
    this.ensureOpen();
    const id = (reservation as MeshSnapshotReservation & { id: number }).id;
    const request = this.reservations.get(id);
    if (!request || request.controller.signal.aborted) {
      throw transferError('The transfer reservation expired', 'TRANSFER_EXPIRED');
    }
    if (input.content.length !== request.contentBytes) {
      throw transferError('The transfer changed while it was loading', 'INVALID_RESPONSE');
    }
    const needsSnapshot = input.content.length > MESH_BINARY_CHUNK_BYTES;
    const token = needsSnapshot ? this.createToken() : undefined;
    const initialChunk = snapshotChunk(input.content, input.offset, input.encoding, token, false);

    this.finishReservation(request);
    if (needsSnapshot && token) {
      this.snapshots.set(token, {
        content: input.content,
        encoding: input.encoding,
        sourceDeviceId: request.sourceDeviceId,
        scope: input.scope,
        metadata: input.metadata,
        expiresAt: this.now() + this.ttlMs,
        deliveredOffsets: new Set([initialChunk.offset]),
      });
      this.totalBytes += input.content.length;
      this.adjustSourceBytes(this.sourceBytes, request.sourceDeviceId, input.content.length);
      this.scheduleExpiry();
    }
    this.drainReservations();
    return { chunk: initialChunk, metadata: input.metadata };
  }

  private validateReservationSize(contentBytes: number): void {
    if (
      !Number.isSafeInteger(contentBytes) ||
      contentBytes < 0 ||
      contentBytes > this.maxSnapshotBytes ||
      contentBytes > this.maxTotalBytes ||
      contentBytes > this.maxSourceBytes
    ) {
      throw transferError('The transfer is too large to snapshot', 'RESOURCE_LIMIT');
    }
  }

  private drainReservations(): void {
    if (this.closed || this.clearing) return;
    for (;;) {
      const index = this.pendingReservations.findIndex((request) => {
        const additionalBytes = request.contentRetained ? 0 : request.contentBytes;
        return (
          this.totalBytes + this.reservedBytes + this.pendingContentBytes + additionalBytes <=
            this.maxTotalBytes &&
          this.sourceUsage(request.sourceDeviceId) + additionalBytes <= this.maxSourceBytes
        );
      });
      if (index < 0) return;
      const [request] = this.pendingReservations.splice(index, 1);
      this.releasePendingContent(request);
      clearTimeout(request.timer);
      request.timer = setTimeout(
        () => this.cancelReservation(request.id, 'The transfer reservation expired'),
        this.reservationTtlMs,
      );
      request.timer.unref?.();
      this.reservations.set(request.id, request);
      this.reservedBytes += request.contentBytes;
      this.adjustSourceBytes(
        this.sourceReservedBytes,
        request.sourceDeviceId,
        request.contentBytes,
      );
      const reservation: MeshSnapshotReservation & { id: number } = {
        id: request.id,
        signal: request.controller.signal,
        commitBinary: (input) =>
          this.commitReservation(reservation, { ...input, encoding: 'base64-binary' }),
        release: () => this.releaseReservation(request.id),
      };
      request.resolve(reservation);
    }
  }

  private cancelReservation(id: number, message: string): void {
    const active = this.reservations.get(id);
    if (active) {
      active.controller.abort();
      this.finishReservation(active);
      active.reject(transferError(message, 'TRANSFER_CANCELLED'));
      this.drainReservations();
      return;
    }
    const index = this.pendingReservations.findIndex((request) => request.id === id);
    if (index < 0) return;
    const [pending] = this.pendingReservations.splice(index, 1);
    this.releasePendingContent(pending);
    pending.controller.abort();
    this.cleanupReservation(pending);
    pending.reject(transferError(message, 'TRANSFER_CANCELLED'));
    this.drainReservations();
  }

  private releaseReservation(id: number): void {
    const request = this.reservations.get(id);
    if (!request) return;
    this.finishReservation(request);
    this.drainReservations();
  }

  private finishReservation(request: ReservationRequest): void {
    if (!this.reservations.delete(request.id)) return;
    this.reservedBytes -= request.contentBytes;
    this.adjustSourceBytes(this.sourceReservedBytes, request.sourceDeviceId, -request.contentBytes);
    this.cleanupReservation(request);
  }

  private cleanupReservation(request: ReservationRequest): void {
    clearTimeout(request.timer);
    request.removeAbortListener();
  }

  private releasePendingContent(request: ReservationRequest): void {
    if (!request.contentRetained) return;
    request.contentRetained = false;
    this.pendingContentBytes -= request.contentBytes;
    this.adjustSourceBytes(
      this.sourcePendingContentBytes,
      request.sourceDeviceId,
      -request.contentBytes,
    );
  }

  private pruneExpired(): void {
    const now = this.now();
    let removed = false;
    for (const [token, snapshot] of this.snapshots) {
      if (snapshot.expiresAt <= now) {
        this.remove(token, snapshot);
        removed = true;
      }
    }
    this.scheduleExpiry();
    if (removed) this.drainReservations();
  }

  private remove(token: string, snapshot: Snapshot): void {
    if (!this.snapshots.delete(token)) return;
    this.totalBytes -= snapshot.content.length;
    this.adjustSourceBytes(this.sourceBytes, snapshot.sourceDeviceId, -snapshot.content.length);
  }

  private sourceUsage(sourceDeviceId: string): number {
    return (
      (this.sourceBytes.get(sourceDeviceId) ?? 0) +
      (this.sourceReservedBytes.get(sourceDeviceId) ?? 0) +
      (this.sourcePendingContentBytes.get(sourceDeviceId) ?? 0)
    );
  }

  private adjustSourceBytes(
    entries: Map<string, number>,
    sourceDeviceId: string,
    delta: number,
  ): void {
    const next = (entries.get(sourceDeviceId) ?? 0) + delta;
    if (next > 0) entries.set(sourceDeviceId, next);
    else entries.delete(sourceDeviceId);
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    let nextExpiry = Infinity;
    for (const snapshot of this.snapshots.values()) {
      nextExpiry = Math.min(nextExpiry, snapshot.expiresAt);
    }
    if (!Number.isFinite(nextExpiry)) return;
    this.expiryTimer = setTimeout(() => this.pruneExpired(), Math.max(0, nextExpiry - this.now()));
    this.expiryTimer.unref?.();
  }

  private ensureOpen(): void {
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
    (!Number.isSafeInteger(parsedOffset) ||
      parsedOffset < 0 ||
      parsedOffset >= content.length ||
      parsedOffset % MESH_BINARY_CHUNK_BYTES !== 0)
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

function transferError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}
