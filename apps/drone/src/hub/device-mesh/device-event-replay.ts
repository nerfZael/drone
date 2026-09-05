import crypto from 'node:crypto';
import type { CapabilityEvent } from '@drone/device-protocol';

/** Bounded advisory event retention. Expired cursors always require a state reconciliation. */
export class DeviceEventReplay {
  private readonly epoch = crypto.randomUUID();
  private sequence = 0;
  private readonly entries: Array<{ cursor: string; target: string; event: CapabilityEvent }> = [];
  get cursor(): string {
    return `${this.epoch}:${this.sequence}`;
  }
  append(target: string, event: CapabilityEvent): string {
    const cursor = `${this.epoch}:${++this.sequence}`;
    this.entries.push({ cursor, target, event });
    while (
      this.entries.length > 1024 ||
      (this.entries[0] && Date.parse(this.entries[0].event.expiresAt) <= Date.now())
    )
      this.entries.shift();
    return cursor;
  }
  after(
    target: string,
    cursor: string,
  ): { reset: boolean; entries: Array<{ cursor: string; event: CapabilityEvent }> } {
    const index = this.entries.findIndex((entry) => entry.cursor === cursor);
    if (!cursor || (index < 0 && cursor !== this.cursor)) return { reset: true, entries: [] };
    return {
      reset: false,
      entries: this.entries
        .slice(index < 0 ? this.entries.length : index + 1)
        .filter(
          (entry) => entry.target === target && Date.parse(entry.event.expiresAt) > Date.now(),
        ),
    };
  }
  deleteDevice(target: string): void {
    for (let i = this.entries.length - 1; i >= 0; i--)
      if (this.entries[i].target === target) this.entries.splice(i, 1);
  }
}
