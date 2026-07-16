import type { IncomingMessage, ServerResponse } from 'node:http';

export interface PromptAutomationEventMeta {
  droneId: string;
  chatName: string;
  name: string;
}

export interface PromptAutomationStatusPayload {
  ok: true;
  automation: 'prompt-loop';
  id: string;
  name: string;
  chat: string;
  job: unknown;
}

export interface PromptAutomationBroadcasterDependencies {
  key(droneId: string, chatName: string): string;
  normalizeDroneId(raw: string): string;
  normalizeChatName(raw: string): string;
  nowIso(): string;
  buildStatusPayload(meta: PromptAutomationEventMeta): Promise<PromptAutomationStatusPayload>;
  writeSseEvent(response: ServerResponse, event: string, data: unknown): void;
}

export interface PromptAutomationEventSubscription {
  req: IncomingMessage;
  res: ServerResponse;
  droneId: string;
  chatName: string;
  name: string;
}

export class PromptAutomationBroadcaster {
  readonly #clientsByKey = new Map<string, Set<ServerResponse>>();
  readonly #lastByKey = new Map<string, string>();
  readonly #metaByKey = new Map<string, PromptAutomationEventMeta>();
  readonly #refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #busyKeys = new Set<string>();
  #keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  #recoveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: PromptAutomationBroadcasterDependencies) {}

  subscribe(opts: PromptAutomationEventSubscription): void {
    const droneId = this.deps.normalizeDroneId(opts.droneId);
    const chatName = this.deps.normalizeChatName(opts.chatName);
    const name = String(opts.name ?? '').trim() || droneId;
    const key = this.deps.key(droneId, chatName);

    opts.res.statusCode = 200;
    opts.res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    opts.res.setHeader('cache-control', 'no-cache, no-transform');
    opts.res.setHeader('connection', 'keep-alive');
    opts.req.socket.setTimeout(0);
    (opts.res as ServerResponse & { flushHeaders?: () => void }).flushHeaders?.();

    const clients = this.#clientsByKey.get(key) ?? new Set<ServerResponse>();
    clients.add(opts.res);
    this.#clientsByKey.set(key, clients);
    this.#metaByKey.set(key, { droneId, chatName, name });

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.#removeClient(key, opts.res);
      this.#stopIfIdle();
    };
    opts.req.on('close', cleanup);
    opts.res.on('close', cleanup);

    this.#start();
    this.deps.writeSseEvent(opts.res, 'connected', { ok: true, at: this.deps.nowIso() });
    void this.#refreshKey(key, { event: 'snapshot', force: true });
  }

  notify(droneIdRaw: string, chatNameRaw: string, delayMs = 0): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (!droneId || !chatName) return;
    const key = this.deps.key(droneId, chatName);
    const clients = this.#clientsByKey.get(key);
    if (!clients?.size) return;
    const existing = this.#metaByKey.get(key);
    this.#metaByKey.set(key, {
      droneId,
      chatName,
      name: existing?.name || droneId,
    });
    this.#scheduleRefresh(key, delayMs);
  }

  close(): void {
    for (const timer of this.#refreshTimers.values()) clearTimeout(timer);
    this.#refreshTimers.clear();
    this.#busyKeys.clear();
    if (this.#keepAliveTimer) clearInterval(this.#keepAliveTimer);
    if (this.#recoveryTimer) clearInterval(this.#recoveryTimer);
    this.#keepAliveTimer = null;
    this.#recoveryTimer = null;
    this.#clientsByKey.clear();
    this.#lastByKey.clear();
    this.#metaByKey.clear();
  }

  async #refreshKey(
    key: string,
    opts?: { event?: 'snapshot' | 'status'; force?: boolean },
  ): Promise<void> {
    const clients = this.#clientsByKey.get(key);
    if (!clients?.size) return;
    if (this.#busyKeys.has(key)) {
      this.#scheduleRefresh(key, 100);
      return;
    }
    const meta = this.#metaByKey.get(key);
    if (!meta) return;

    this.#busyKeys.add(key);
    try {
      const payload = await this.deps.buildStatusPayload(meta);
      const fingerprint = JSON.stringify(payload.job);
      if (opts?.force || this.#lastByKey.get(key) !== fingerprint) {
        this.#lastByKey.set(key, fingerprint);
        this.#broadcast(key, opts?.event ?? 'status', payload);
      }
    } catch (error: any) {
      this.#broadcast(key, 'stream-error', {
        ok: false,
        error: error?.message ?? String(error),
      });
    } finally {
      this.#busyKeys.delete(key);
      this.#stopIfIdle();
    }
  }

  #broadcast(key: string, event: string, data: unknown): void {
    const clients = this.#clientsByKey.get(key);
    if (!clients) return;
    for (const client of Array.from(clients)) {
      if (client.destroyed || client.writableEnded) {
        clients.delete(client);
        continue;
      }
      this.deps.writeSseEvent(client, event, data);
    }
    if (clients.size === 0) this.#removeKey(key);
  }

  #removeClient(key: string, response: ServerResponse): void {
    const clients = this.#clientsByKey.get(key);
    clients?.delete(response);
    if (clients && clients.size === 0) this.#removeKey(key);
  }

  #removeKey(key: string): void {
    this.#clientsByKey.delete(key);
    this.#lastByKey.delete(key);
    this.#metaByKey.delete(key);
    const timer = this.#refreshTimers.get(key);
    if (timer) clearTimeout(timer);
    this.#refreshTimers.delete(key);
    this.#busyKeys.delete(key);
  }

  #scheduleRefresh(key: string, delayMs = 0): void {
    const clients = this.#clientsByKey.get(key);
    if (!clients?.size || this.#refreshTimers.has(key)) return;
    const timer = setTimeout(
      () => {
        this.#refreshTimers.delete(key);
        void this.#refreshKey(key);
      },
      Math.max(0, delayMs),
    );
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.#refreshTimers.set(key, timer);
  }

  #start(): void {
    if (!this.#keepAliveTimer) {
      this.#keepAliveTimer = setInterval(() => {
        for (const [key, clients] of Array.from(this.#clientsByKey.entries())) {
          for (const client of Array.from(clients)) {
            if (client.destroyed || client.writableEnded) clients.delete(client);
            else client.write(': keepalive\n\n');
          }
          if (clients.size === 0) this.#removeKey(key);
        }
        this.#stopIfIdle();
      }, 25_000);
      (this.#keepAliveTimer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    }
    if (!this.#recoveryTimer) {
      this.#recoveryTimer = setInterval(() => {
        for (const key of this.#clientsByKey.keys()) this.#scheduleRefresh(key);
      }, 5_000);
      (this.#recoveryTimer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    }
  }

  #stopIfIdle(): void {
    if (this.#clientCount() > 0) return;
    for (const timer of this.#refreshTimers.values()) clearTimeout(timer);
    this.#refreshTimers.clear();
    this.#busyKeys.clear();
    if (this.#keepAliveTimer) clearInterval(this.#keepAliveTimer);
    if (this.#recoveryTimer) clearInterval(this.#recoveryTimer);
    this.#keepAliveTimer = null;
    this.#recoveryTimer = null;
  }

  #clientCount(): number {
    let count = 0;
    for (const clients of this.#clientsByKey.values()) count += clients.size;
    return count;
  }
}
