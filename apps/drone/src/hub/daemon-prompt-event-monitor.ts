import type { DroneClient } from '../host/api';

const IDLE_TIMEOUT_MS = 70_000;

export function daemonPromptEventWakeKind(job: any): 'terminal' | 'approval-pending' | null {
  const state = String(job?.state ?? '').trim();
  if (state === 'done' || state === 'failed' || state === 'canceled') return 'terminal';
  return Number(job?.pendingApprovalCount ?? 0) > 0 ? 'approval-pending' : null;
}

export class DaemonPromptEventMonitor {
  private readonly monitors = new Map<string, { abort: AbortController; task: Promise<void> }>();
  private readonly wakeTasks = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly deps: {
      normalizeDroneId: (value: string) => string;
      resolveClient: (droneId: string) => Promise<{ exists: boolean; client: DroneClient | null }>;
      onTerminalPrompt: (droneId: string, promptId: string) => Promise<void>;
      onApprovalPending?: (droneId: string, promptId: string) => Promise<void>;
      sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    },
  ) {}

  start(): void {
    this.stopped = false;
  }

  private handleEvent(droneId: string, eventName: string, dataText: string): void {
    let data: any = null;
    try {
      data = JSON.parse(dataText || '{}');
    } catch {
      return;
    }
    const jobs =
      eventName === 'snapshot' && Array.isArray(data?.jobs)
        ? data.jobs
        : data?.job
          ? [data.job]
          : [];
    for (const job of jobs) {
      const promptId = String(job?.id ?? '').trim();
      if (!promptId) continue;
      const wakeKind = daemonPromptEventWakeKind(job);
      const handler =
        wakeKind === 'terminal'
          ? this.deps.onTerminalPrompt
          : wakeKind === 'approval-pending'
            ? this.deps.onApprovalPending
            : null;
      if (!handler) continue;
      const task = handler(droneId, promptId).catch(() => {});
      this.wakeTasks.add(task);
      void task.finally(() => this.wakeTasks.delete(task));
    }
  }

  private async readStream(opts: {
    droneId: string;
    client: DroneClient;
    signal: AbortSignal;
  }): Promise<void> {
    const url = new URL('/v1/prompts/events', opts.client.baseUrl);
    const response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${opts.client.token}`,
        accept: 'text/event-stream',
      },
      signal: opts.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `daemon prompt event stream failed: ${response.status} ${response.statusText}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!opts.signal.aborted) {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let readResult: Awaited<ReturnType<typeof reader.read>> | null;
      try {
        readResult = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => {
            idleTimer = setTimeout(() => resolve(null), IDLE_TIMEOUT_MS);
            idleTimer.unref?.();
          }),
        ]);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
      if (readResult === null) {
        await reader.cancel().catch(() => {});
        throw new Error('daemon prompt event stream idle timeout');
      }
      if (readResult.done) break;
      buffer += decoder.decode(readResult.value, { stream: true });

      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const rawLine of frame.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
          else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
          }
        }
        if (dataLines.length > 0) this.handleEvent(opts.droneId, eventName, dataLines.join('\n'));
        separatorIndex = buffer.indexOf('\n\n');
      }
    }
    if (!opts.signal.aborted) throw new Error('daemon prompt event stream ended');
  }

  ensure(droneIdRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    if (this.stopped || !droneId || this.monitors.has(droneId)) return;
    const abort = new AbortController();
    const task = (async () => {
      let attempt = 0;
      while (!abort.signal.aborted) {
        try {
          const target = await this.deps.resolveClient(droneId);
          if (!target.exists) return;
          if (!target.client) throw new Error(`daemon unavailable for ${droneId}`);
          await this.readStream({ droneId, client: target.client, signal: abort.signal });
          attempt = 0;
        } catch {
          if (abort.signal.aborted) break;
          attempt = Math.min(8, attempt + 1);
          await this.deps.sleep(Math.min(30_000, 500 * 2 ** attempt), abort.signal).catch(() => {});
        }
      }
    })().finally(() => {
      const current = this.monitors.get(droneId);
      if (current?.abort === abort) this.monitors.delete(droneId);
    });
    this.monitors.set(droneId, { abort, task });
    void task;
  }

  async close(): Promise<void> {
    this.stopped = true;
    const monitors = [...this.monitors.values()];
    for (const monitor of monitors) monitor.abort.abort();
    this.monitors.clear();
    await Promise.allSettled(monitors.map((monitor) => monitor.task));
    await Promise.allSettled(this.wakeTasks);
  }
}
