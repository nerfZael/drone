export class TrailingDirectoryRequestTracker {
  private readonly inFlightByPath = new Map<string, number>();
  private readonly trailingByPath = new Map<string, number>();

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

  finish(path: string, sequence: number): boolean {
    if (this.inFlightByPath.get(path) === sequence) this.inFlightByPath.delete(path);
    const shouldRunTrailing = this.trailingByPath.get(path) === sequence;
    if (shouldRunTrailing) this.trailingByPath.delete(path);
    return shouldRunTrailing;
  }

  discardTrailing(path: string): void {
    this.trailingByPath.delete(path);
  }

  reset(): void {
    this.inFlightByPath.clear();
    this.trailingByPath.clear();
  }
}
