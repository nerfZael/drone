type RefreshTask = {
  priority: number;
  run: () => Promise<void>;
};

export class CoalescedRefresh {
  private active: Promise<void> | null = null;
  private queued: RefreshTask | null = null;

  request(run: () => Promise<void>, priority = 0): Promise<void> {
    if (this.active) {
      if (!this.queued || priority >= this.queued.priority) this.queued = { priority, run };
      return this.active;
    }
    this.queued = { priority, run };
    const request = (async () => {
      let failed = false;
      let firstError: unknown;
      while (this.queued) {
        const next = this.queued;
        this.queued = null;
        try {
          await next.run();
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
      if (failed) throw firstError;
    })();
    const active = request.finally(() => {
      if (this.active === active) this.active = null;
    });
    this.active = active;
    return active;
  }
}
