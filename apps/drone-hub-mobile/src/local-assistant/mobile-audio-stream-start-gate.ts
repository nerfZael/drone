export class MobileAudioStreamStartGate {
  private requestGeneration = 0;
  private pendingStart: Promise<boolean> | null = null;

  start(operation: (isCurrent: () => boolean) => Promise<void>): Promise<boolean> {
    if (this.pendingStart) return this.pendingStart;
    const generation = ++this.requestGeneration;
    const isCurrent = () => this.requestGeneration === generation;
    const work = (async () => {
      await operation(isCurrent);
      return isCurrent();
    })();
    this.pendingStart = work;
    void work
      .finally(() => {
        if (this.pendingStart === work) this.pendingStart = null;
      })
      .catch(() => undefined);
    return work;
  }

  async cancel(stop: () => void): Promise<void> {
    this.requestGeneration += 1;
    stop();
    await this.pendingStart?.catch(() => undefined);
    stop();
  }
}
