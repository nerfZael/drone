import { normalizeMobileChatLoad, type MobileChatLoadRecord } from '@drone/device-protocol';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
const KEY = 'droneHub.mobileChatLoads.v1';
export class ChatLoadBuffer {
  private queue: Promise<unknown> = Promise.resolve();
  private uploading = false;
  constructor(private readonly storage: Storage) {}
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async read(): Promise<Array<{ record: MobileChatLoadRecord; uploaded: boolean }>> {
    const raw = await this.storage.getItem(KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw)
        .flatMap((entry: any) => {
          const record = normalizeMobileChatLoad(entry?.record);
          return record ? [{ record, uploaded: entry.uploaded === true }] : [];
        })
        .slice(-100);
    } catch {
      return [];
    }
  }
  append(record: MobileChatLoadRecord): Promise<void> {
    return this.serialize(async () => {
      const records = (await this.read()).filter(
        (entry) => entry.record.navigationId !== record.navigationId,
      );
      records.push({ record, uploaded: false });
      await this.storage.setItem(KEY, JSON.stringify(records.slice(-100)));
    });
  }
  list() {
    return this.serialize(() => this.read());
  }
  async flush(
    send: (target: string, records: MobileChatLoadRecord[]) => Promise<{ accepted: string[] }>,
  ): Promise<void> {
    if (this.uploading) return;
    this.uploading = true;
    try {
      const pending = (await this.list()).filter((entry) => !entry.uploaded);
      for (const target of new Set(pending.map((entry) => entry.record.targetDeviceId))) {
        // One small batch per destination per tick; failures retain records for retry.
        const records = pending
          .filter((entry) => entry.record.targetDeviceId === target)
          .slice(0, 10)
          .map((entry) => entry.record);
        try {
          const result = await send(target, records);
          const accepted = new Set(Array.isArray(result?.accepted) ? result.accepted : []);
          await this.serialize(async () => {
            const entries = await this.read();
            for (const entry of entries)
              if (
                records.some((r) => r.navigationId === entry.record.navigationId) &&
                accepted.has(entry.record.navigationId)
              )
                entry.uploaded = true;
            await this.storage.setItem(KEY, JSON.stringify(entries));
          });
        } catch {
          /* Retry after reconnect or next tick. */
        }
      }
    } finally {
      this.uploading = false;
    }
  }
}
