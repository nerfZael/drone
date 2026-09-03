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
  maxBytes: number;
  commitJson(input: { value: unknown; scope: string; offset?: unknown }): MeshSnapshotChunk;
  commitBinary(input: { content: Buffer; scope: string; metadata?: unknown; offset?: unknown }): {
    chunk: MeshSnapshotChunk;
    metadata: unknown;
  };
  release(): void;
};

export type MeshSnapshotOwnerLease = {
  sourceDeviceId: string;
  generation: number;
  signal: AbortSignal;
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
  maxPendingReservationsPerSource?: number;
  now?: () => number;
  createToken?: () => string;
};

type ReservationRequest = {
  id: number;
  sourceDeviceId: string;
  owner: MeshSnapshotOwnerLease;
  contentBytes: number;
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
const DEFAULT_MAX_PENDING_RESERVATIONS_PER_SOURCE = 4;

type OwnerState = {
  generation: number;
  controller: AbortController;
};

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
  private readonly maxPendingReservationsPerSource: number;
  private readonly now: () => number;
  private readonly createToken: () => string;
  private totalBytes = 0;
  private reservedBytes = 0;
  private readonly sourceBytes = new Map<string, number>();
  private readonly sourceReservedBytes = new Map<string, number>();
  private readonly owners = new Map<string, OwnerState>();
  private nextReservationId = 1;
  private lastAdmittedSourceDeviceId: string | null = null;
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
    this.maxPendingReservationsPerSource =
      options.maxPendingReservationsPerSource ??
      Math.min(
        DEFAULT_MAX_PENDING_RESERVATIONS_PER_SOURCE,
        Math.max(1, Math.ceil(this.maxPendingReservations / 4)),
      );
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ?? (() => crypto.randomUUID());
  }

  async createJson(input: {
    value: unknown;
    sourceDeviceId: string;
    scope: string;
    offset?: unknown;
    signal?: AbortSignal;
    owner?: MeshSnapshotOwnerLease;
  }): Promise<MeshSnapshotChunk> {
    const owner = input.owner ?? this.captureOwner(input.sourceDeviceId);
    const reservation = await this.reserveJson(owner, input.signal);
    try {
      return reservation.commitJson({
        value: input.value,
        scope: input.scope,
        offset: input.offset,
      });
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
    owner?: MeshSnapshotOwnerLease;
  }): Promise<{ chunk: MeshSnapshotChunk; metadata: unknown }> {
    this.ensureOpen();
    const reservation = await this.reserve(
      input.sourceDeviceId,
      input.content.length,
      input.signal,
      input.owner,
    );
    try {
      return this.commitReservation(reservation, { ...input, encoding: 'base64-binary' }, true);
    } finally {
      reservation.release();
    }
  }

  async reserve(
    sourceDeviceId: string,
    contentBytes: number,
    signal?: AbortSignal,
    owner = this.captureOwner(sourceDeviceId),
  ): Promise<MeshSnapshotReservation> {
    this.ensureOpen();
    this.ensureCurrentOwner(owner, sourceDeviceId);
    this.pruneExpired();
    this.validateReservationSize(contentBytes);
    if (signal?.aborted || owner.signal.aborted) {
      return Promise.reject(transferError('The transfer was cancelled', 'TRANSFER_CANCELLED'));
    }
    if (this.pendingReservations.length >= this.maxPendingReservations) {
      return Promise.reject(transferError('The transfer queue is full', 'RESOURCE_LIMIT'));
    }
    const sourcePending = this.pendingReservations.filter(
      (request) => request.sourceDeviceId === sourceDeviceId,
    ).length;
    if (sourcePending >= this.maxPendingReservationsPerSource) {
      return Promise.reject(transferError('The transfer queue is full', 'RESOURCE_LIMIT'));
    }

    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const id = this.nextReservationId++;
      const onAbort = () => this.cancelReservation(id, 'The transfer was cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      owner.signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => this.cancelReservation(id, 'The transfer reservation expired'),
        this.reservationTtlMs + 5_000,
      );
      timer.unref?.();
      const request: ReservationRequest = {
        id,
        sourceDeviceId,
        owner,
        contentBytes,
        controller,
        timer,
        removeAbortListener: () => {
          signal?.removeEventListener('abort', onAbort);
          owner.signal.removeEventListener('abort', onAbort);
        },
        resolve,
        reject,
      };
      this.pendingReservations.push(request);
      this.drainReservations();
    });
  }

  captureOwner(sourceDeviceId: string): MeshSnapshotOwnerLease {
    this.ensureOpen();
    let owner = this.owners.get(sourceDeviceId);
    if (!owner) {
      owner = { generation: 0, controller: new AbortController() };
      this.owners.set(sourceDeviceId, owner);
    }
    return {
      sourceDeviceId,
      generation: owner.generation,
      signal: owner.controller.signal,
    };
  }

  reserveJson(
    owner: MeshSnapshotOwnerLease,
    signal?: AbortSignal,
  ): Promise<MeshSnapshotReservation> {
    return this.reserve(owner.sourceDeviceId, this.maxSnapshotBytes, signal, owner);
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
    this.invalidateOwner(sourceDeviceId);
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
    for (const [sourceDeviceId] of this.owners) this.invalidateOwner(sourceDeviceId);
    this.snapshots.clear();
    this.totalBytes = 0;
    this.sourceBytes.clear();
    for (const request of [...this.reservations.values(), ...this.pendingReservations]) {
      this.cancelReservation(request.id, 'The transfer store was cleared');
    }
    this.reservations.clear();
    this.pendingReservations.length = 0;
    this.reservedBytes = 0;
    this.sourceReservedBytes.clear();
    this.owners.clear();
    this.lastAdmittedSourceDeviceId = null;
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
    exactBytes: boolean,
  ): { chunk: MeshSnapshotChunk; metadata: unknown } {
    this.ensureOpen();
    const id = (reservation as MeshSnapshotReservation & { id: number }).id;
    const request = this.reservations.get(id);
    if (!request || request.controller.signal.aborted) {
      throw transferError('The transfer reservation expired', 'TRANSFER_EXPIRED');
    }
    this.ensureCurrentOwner(request.owner, request.sourceDeviceId);
    if (
      input.content.length > request.contentBytes ||
      input.content.length > this.maxSnapshotBytes ||
      (exactBytes && input.content.length !== request.contentBytes)
    ) {
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
      const index = this.nextPendingReservationIndex();
      if (index < 0) return;
      const [request] = this.pendingReservations.splice(index, 1);
      try {
        this.ensureCurrentOwner(request.owner, request.sourceDeviceId);
      } catch (error: any) {
        request.controller.abort();
        this.cleanupReservation(request);
        request.reject(error);
        continue;
      }
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
      this.lastAdmittedSourceDeviceId = request.sourceDeviceId;
      const reservation: MeshSnapshotReservation & { id: number } = {
        id: request.id,
        signal: request.controller.signal,
        maxBytes: request.contentBytes,
        commitJson: (input) => {
          let content: Buffer;
          try {
            content = Buffer.from(JSON.stringify(input.value));
          } catch {
            throw transferError('The transfer content is not serializable', 'INVALID_RESPONSE');
          }
          return this.commitReservation(
            reservation,
            { ...input, content, encoding: 'base64-json-utf8' },
            false,
          ).chunk;
        },
        commitBinary: (input) =>
          this.commitReservation(reservation, { ...input, encoding: 'base64-binary' }, true),
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
      (this.sourceReservedBytes.get(sourceDeviceId) ?? 0)
    );
  }

  private nextPendingReservationIndex(): number {
    const sources = [...new Set(this.pendingReservations.map((request) => request.sourceDeviceId))];
    if (sources.length === 0) return -1;
    const previousIndex = this.lastAdmittedSourceDeviceId
      ? sources.indexOf(this.lastAdmittedSourceDeviceId)
      : -1;
    const ordered =
      previousIndex < 0
        ? sources
        : [...sources.slice(previousIndex + 1), ...sources.slice(0, previousIndex + 1)];
    for (const sourceDeviceId of ordered) {
      const index = this.pendingReservations.findIndex(
        (request) =>
          request.sourceDeviceId === sourceDeviceId &&
          this.totalBytes + this.reservedBytes + request.contentBytes <= this.maxTotalBytes &&
          this.sourceUsage(sourceDeviceId) + request.contentBytes <= this.maxSourceBytes,
      );
      if (index >= 0) return index;
    }
    return -1;
  }

  private ensureCurrentOwner(owner: MeshSnapshotOwnerLease, sourceDeviceId: string): void {
    const current = this.owners.get(sourceDeviceId);
    if (
      owner.sourceDeviceId !== sourceDeviceId ||
      owner.signal.aborted ||
      !current ||
      current.generation !== owner.generation ||
      current.controller.signal !== owner.signal
    ) {
      throw transferError('Transfer access was removed', 'TRANSFER_CANCELLED');
    }
  }

  private invalidateOwner(sourceDeviceId: string): void {
    const current = this.owners.get(sourceDeviceId);
    current?.controller.abort();
    this.owners.set(sourceDeviceId, {
      generation: (current?.generation ?? 0) + 1,
      controller: new AbortController(),
    });
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
