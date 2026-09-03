export class MobileDirectoryRequestTracker {
  private readonly active = new Map<string, symbol>();
  private readonly trailingForced = new Set<string>();

  begin(path: string, force: boolean): symbol | null {
    if (this.active.has(path)) {
      if (force) this.trailingForced.add(path);
      return null;
    }
    const token = Symbol(path);
    this.active.set(path, token);
    return token;
  }

  finish(path: string, token: symbol): boolean {
    if (this.active.get(path) !== token) return false;
    this.active.delete(path);
    return this.trailingForced.delete(path);
  }

  reset(): void {
    this.active.clear();
    this.trailingForced.clear();
  }
}
