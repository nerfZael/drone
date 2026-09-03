import type { CapabilityResponse } from '@drone/device-protocol';

type CachedResponse = {
  deviceId: string;
  expiresAt: number;
  fingerprint: string;
  response: CapabilityResponse;
  bytes: number;
};

type ResponseCacheOptions = {
  maxBytes?: number;
  maxEntryBytes?: number;
  ttlMs?: number;
  now?: () => number;
};

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 64 * 1024;
const DEFAULT_TTL_MS = 60_000;

/** A short-lived, byte-bounded replay cache for small capability responses. */
export class DeviceMeshResponseCache {
  private readonly entries = new Map<string, CachedResponse>();
  private readonly maxBytes: number;
  private readonly maxEntryBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private totalBytes = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ResponseCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get(key: string): CachedResponse | undefined {
    this.pruneExpired();
    return this.entries.get(key);
  }

  set(input: {
    key: string;
    deviceId: string;
    requestExpiresAt: number;
    fingerprint: string;
    response: CapabilityResponse;
  }): boolean {
    this.pruneExpired();
    const serializedBytes = Buffer.byteLength(JSON.stringify(input.response));
    if (serializedBytes > this.maxEntryBytes || serializedBytes > this.maxBytes) return false;
    const expiresAt = Math.min(input.requestExpiresAt, this.now() + this.ttlMs);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) return false;

    this.delete(input.key);
    while (this.totalBytes + serializedBytes > this.maxBytes && this.entries.size > 0) {
      this.delete(this.entries.keys().next().value as string);
    }
    if (this.totalBytes + serializedBytes > this.maxBytes) return false;
    this.entries.set(input.key, {
      deviceId: input.deviceId,
      expiresAt,
      fingerprint: input.fingerprint,
      response: input.response,
      bytes: serializedBytes,
    });
    this.totalBytes += serializedBytes;
    this.scheduleExpiry();
    return true;
  }

  deleteDevice(deviceId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.deviceId === deviceId) this.delete(key);
    }
    this.scheduleExpiry();
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  get byteSize(): number {
    this.pruneExpired();
    return this.totalBytes;
  }

  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || !this.entries.delete(key)) return;
    this.totalBytes -= entry.bytes;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.delete(key);
    }
    this.scheduleExpiry();
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    let nextExpiry = Infinity;
    for (const entry of this.entries.values()) nextExpiry = Math.min(nextExpiry, entry.expiresAt);
    if (!Number.isFinite(nextExpiry)) return;
    this.expiryTimer = setTimeout(() => this.pruneExpired(), Math.max(0, nextExpiry - this.now()));
    this.expiryTimer.unref?.();
  }
}
