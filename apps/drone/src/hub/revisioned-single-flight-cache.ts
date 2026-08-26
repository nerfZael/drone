type CacheEntry<T> = {
  revision: number;
  value: T;
};

type InFlightEntry<T> = {
  revision: number;
  promise: Promise<T>;
};

/**
 * Caches keyed async reads until their owning data is explicitly invalidated.
 * Calls for the same key and revision share one load. An invalidation also
 * prevents an older in-flight load from publishing stale data afterward.
 */
export class RevisionedSingleFlightCache<K, T> {
  private readonly cached = new Map<K, CacheEntry<T>>();
  private readonly inFlight = new Map<K, InFlightEntry<T>>();
  private revision = 0;

  getOrLoad(key: K, load: () => T | Promise<T>): Promise<T> {
    const revision = this.revision;
    const cached = this.cached.get(key);
    if (cached?.revision === revision) return Promise.resolve(cached.value);

    const existing = this.inFlight.get(key);
    if (existing?.revision === revision) return existing.promise;

    const promise = Promise.resolve()
      .then(load)
      .then((value) => {
        if (this.revision === revision) this.cached.set(key, { revision, value });
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
      });
    this.inFlight.set(key, { revision, promise });
    return promise;
  }

  invalidate(): void {
    this.revision += 1;
    this.cached.clear();
    this.inFlight.clear();
  }
}
