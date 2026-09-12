/** One timer per cache, active only while there is something to expire. */
export class CacheExpiryTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;

  constructor(
    private readonly expire: (nowMs: number) => number | null,
    private readonly now = () => Date.now(),
  ) {}

  schedule(deadline: number): void {
    if (this.deadline !== null && this.deadline <= deadline) return;
    this.clear();
    this.deadline = deadline;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      const next = this.expire(this.now());
      if (next !== null) this.schedule(next);
    }, Math.max(1, Math.min(2_147_483_647, deadline - this.now())));
    // The same utility runs in browsers and Node; cache cleanup must not keep
    // an otherwise finished backend process alive.
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }
}

/** Removes expired values even when their keys are never requested again. */
export class ExpiringMap<K, V> extends Map<K, V> {
  private readonly expiry: CacheExpiryTimer;

  constructor(expiresAt: (value: V) => number, now = () => Date.now()) {
    super();
    this.expiry = new CacheExpiryTimer((nowMs) => {
      let next: number | null = null;
      for (const [key, value] of this) {
        const deadline = expiresAt(value);
        if (deadline <= nowMs) super.delete(key);
        else next = next === null ? deadline : Math.min(next, deadline);
      }
      return next;
    }, now);
    this.expiresAt = expiresAt;
  }

  private readonly expiresAt: (value: V) => number;

  override set(key: K, value: V): this {
    super.set(key, value);
    this.expiry.schedule(this.expiresAt(value));
    return this;
  }

  override delete(key: K): boolean {
    const deleted = super.delete(key);
    if (this.size === 0) this.expiry.clear();
    return deleted;
  }

  override clear(): void {
    super.clear();
    this.expiry.clear();
  }
}
