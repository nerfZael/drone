export class ShortLivedSingleFlightCache<T> {
  private readonly cached = new Map<string, { expiresAt: number; value: T }>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private generation = 0;

  constructor(
    private readonly ttlMs = 2_000,
    private readonly now = () => Date.now(),
  ) {}

  getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.cached.get(key);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.value);
    if (cached) this.cached.delete(key);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const generation = this.generation;
    const pending = load()
      .then((value) => {
        if (generation === this.generation) {
          this.cached.set(key, { expiresAt: this.now() + this.ttlMs, value });
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      });
    this.inFlight.set(key, pending);
    return pending;
  }

  invalidate(key?: string): void {
    this.generation += 1;
    if (key === undefined) {
      this.cached.clear();
      return;
    }
    this.cached.delete(key);
  }
}
