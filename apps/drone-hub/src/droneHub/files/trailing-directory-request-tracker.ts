export class TrailingDirectoryRequestTracker {
  private readonly inFlightByPath = new Map<string, number>();
  private readonly trailingByPath = new Map<string, number>();
  private readonly invalidatedByPath = new Map<string, number>();

  activeSequence(path: string): number | null {
    return this.inFlightByPath.get(path) ?? null;
  }

  begin(path: string, sequence: number): void {
    this.inFlightByPath.set(path, sequence);
  }

  requestTrailing(path: string, sequence: number): void {
    if (this.inFlightByPath.get(path) === sequence) {
      this.trailingByPath.set(path, sequence);
    }
  }

  invalidate(path: string, sequence: number, queueTrailing: boolean): void {
    if (this.inFlightByPath.get(path) !== sequence) return;
    this.invalidatedByPath.set(path, sequence);
    if (queueTrailing) this.requestTrailing(path, sequence);
  }

  isInvalidated(path: string, sequence: number): boolean {
    return this.invalidatedByPath.get(path) === sequence;
  }

  finish(path: string, sequence: number): boolean {
    if (this.inFlightByPath.get(path) === sequence) this.inFlightByPath.delete(path);
    const shouldRunTrailing = this.trailingByPath.get(path) === sequence;
    if (shouldRunTrailing) this.trailingByPath.delete(path);
    if (this.invalidatedByPath.get(path) === sequence) this.invalidatedByPath.delete(path);
    return shouldRunTrailing;
  }

  cancelReplacement(path: string): void {
    this.trailingByPath.delete(path);
    this.invalidatedByPath.delete(path);
  }

  reset(): void {
    this.inFlightByPath.clear();
    this.trailingByPath.clear();
    this.invalidatedByPath.clear();
  }
}
