type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export class BoundedSwrCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly options: {
      maxEntries: number;
      maxAgeMs: number;
      now?: () => number;
      onEvict?: (value: T) => void;
    },
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.remove(key, entry);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, equal?: (current: T, next: T) => boolean): T {
    const current = this.entries.get(key);
    const retained = current && equal?.(current.value, value) ? current.value : value;
    if (current) {
      this.entries.delete(key);
      if (retained !== current.value) this.options.onEvict?.(current.value);
    }
    this.entries.set(key, {
      expiresAt: this.now() + Math.max(1, this.options.maxAgeMs),
      value: retained,
    });
    while (this.entries.size > Math.max(1, this.options.maxEntries)) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) this.remove(oldestKey, oldest);
    }
    return retained;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.remove(key, entry);
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.remove(key, entry);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private remove(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key);
    this.options.onEvict?.(entry.value);
  }
}
