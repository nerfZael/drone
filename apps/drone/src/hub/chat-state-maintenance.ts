export type ChatStateMaintenanceInput = {
  droneId: string;
  chatName: string;
  chatEntry: any;
  includeDockerSnapshotMaintenance?: boolean;
};

export class ChatStateMaintenanceScheduler {
  private readonly lastRun = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly latest = new Map<string, ChatStateMaintenanceInput>();
  private stopped = false;

  constructor(
    private readonly deps: {
      normalizeDroneId: (value: string) => string;
      normalizeChatName: (value: string) => string;
      run: (input: ChatStateMaintenanceInput) => void;
      logError: (input: { droneId: string; chatName: string; error: unknown }) => void;
      throttleMs?: number;
    },
  ) {}

  start(): void {
    this.stopped = false;
  }

  schedule(input: ChatStateMaintenanceInput): void {
    if (this.stopped) return;
    const droneId = this.deps.normalizeDroneId(input.droneId);
    const chatName = this.deps.normalizeChatName(input.chatName);
    if (!droneId || !chatName) return;
    const key = `${droneId}:${chatName}`;
    this.latest.set(key, { ...input, droneId, chatName });
    if (this.timers.has(key)) return;

    const throttleMs = Math.max(0, this.deps.throttleMs ?? 5_000);
    const elapsedMs = Date.now() - (this.lastRun.get(key) ?? 0);
    const timer = setTimeout(
      () => {
        this.timers.delete(key);
        const latest = this.latest.get(key);
        this.latest.delete(key);
        this.lastRun.set(key, Date.now());
        if (!latest) return;
        try {
          this.deps.run(latest);
        } catch (error) {
          this.deps.logError({ droneId, chatName, error });
        }
      },
      Math.max(0, throttleMs - elapsedMs),
    );
    timer.unref?.();
    this.timers.set(key, timer);
  }

  close(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.latest.clear();
  }
}
