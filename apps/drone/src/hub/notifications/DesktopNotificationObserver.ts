import type { ChatSubscriptionStatus } from '../subscriptions/resource-subscription-service';

type ChatRef = { droneId: string; chatName: string };
type Status = ChatSubscriptionStatus & { droneName: string };
export type DesktopNotificationEvent = ChatRef & {
  id: string;
  kind: 'finished' | 'failed' | 'message';
  droneName: string;
  body?: string;
  eventName?: string;
};

/** One live connection: establish a baseline, serialize reads, and never replay history. */
export class DesktopNotificationObserver {
  private readonly previous = new Map<string, Status>();
  private readonly pending = new Map<string, ChatRef>();
  private reading: { key: string; removed: boolean } | null = null;
  private running = false;
  private closed = false;

  constructor(
    private readonly readStatus: (chat: ChatRef) => Promise<Status>,
    private readonly publish: (event: DesktopNotificationEvent) => void,
  ) {}

  update(chats: ChatRef[], removed: ChatRef[] = []): void {
    for (const chat of removed) {
      const key = JSON.stringify([chat.droneId, chat.chatName]);
      this.previous.delete(key);
      this.pending.delete(key);
      if (this.reading?.key === key) this.reading.removed = true;
    }
    for (const chat of chats) {
      const key = JSON.stringify([chat.droneId, chat.chatName]);
      this.pending.set(key, chat);
    }
    void this.drain();
  }

  close(): void {
    this.closed = true;
    this.pending.clear();
    this.previous.clear();
  }

  private async drain(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.pending.size && !this.closed) {
        const [key, chat] = this.pending.entries().next().value!;
        this.pending.delete(key);
        const reading = { key, removed: false };
        this.reading = reading;
        try {
          const status = await this.readStatus(chat);
          if (this.closed || reading.removed) continue;
          const previous = this.previous.get(key);
          this.previous.set(key, status);
          if (!previous) continue;
          const latest = status.latest;
          if (!latest?.id) continue;
          const changed = latest.id !== previous.latest?.id || latest.status !== previous.latest?.status;
          const failed = latest.status === 'failed';
          const finished = status.idle && status.reason === 'latest_agent_message' && latest.status === 'completed';
          if (failed ? changed : finished && (changed || !previous.idle)) {
            const kind = failed ? 'failed' : 'finished';
            this.publish({ ...chat, id: `${key}:${latest.id}:${kind}`, kind, droneName: status.droneName });
          }
        } catch {
          // Deleted/temporarily unavailable chats must not block other notifications.
          // A later invalidation retries the read without losing the previous baseline.
        } finally {
          this.reading = null;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
