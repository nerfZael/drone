import { CompanionLiveConversation } from './CompanionLiveConversation.js';
import type { CompanionClientController } from './companion-client.js';
import type { CompanionClientTelemetry } from './companion.js';
import { companionLiveReconnectDelay } from './companion-live-reconnect.js';
import { connectCompanionLiveReplies } from './companion-live-replies.js';
import { CompanionLiveTiming } from './companion-live-timing.js';

export type CompanionLiveTarget = {
  id: string;
  name: string;
  run(prompt: string, signal: AbortSignal, telemetry?: CompanionClientTelemetry): Promise<string>;
};
export type CompanionLiveState = {
  hasStarted: boolean;
  status: 'idle' | 'connecting' | 'listening' | 'paused' | 'error';
  capturing: boolean;
  error: string;
  captions: string;
  queued: number;
  muted: boolean;
  playbackBlocked: boolean;
  backendModel: string;
  targetDeviceId: string;
  targetName: string;
};
export type CompanionLiveCloseReason = 'stop' | 'pause' | 'reconnect';
export type CompanionLiveConnectionHandle = {
  start(): Promise<void>;
  close(reason: CompanionLiveCloseReason): Promise<void>;
  mute(muted: boolean): void;
  send(event: Record<string, unknown>): void;
  play?(): Promise<void>;
};
export type CompanionLiveConnectionOptions = {
  target: CompanionLiveTarget;
  signal: AbortSignal;
  timing: CompanionLiveTiming;
  reconnecting: boolean;
  onEvent(event: Record<string, unknown>): void;
  onCapturing(): void;
  onReady(model: string): void;
  onError(error: string): void;
  onPlaybackBlocked(blocked: boolean): void;
  onStop(): void;
};
type Schedule = (callback: () => void, delayMs: number) => () => void;
export type CompanionLivePlatform = {
  canStart?(): boolean;
  prepare?(signal: AbortSignal): Promise<void>;
  createConnection(options: CompanionLiveConnectionOptions): CompanionLiveConnectionHandle;
  schedule?: Schedule;
  /** Controls may outlive audio on pause or while a headset shortcut is armed. */
  stopped?(audioReleased: Promise<void>, paused: boolean): Promise<void>;
};
type Attempt = {
  abort: AbortController;
  prepared: Promise<void>;
  connection?: CompanionLiveConnectionHandle;
  conversation: CompanionLiveConversation;
  replies?: ReturnType<typeof connectCompanionLiveReplies>;
};

/** Owns Live intent and connection attempts; backend work has its own lifetime. */
export class CompanionLiveController {
  private state: CompanionLiveState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private target: CompanionLiveTarget | null = null;
  private attempt: Attempt | null = null;
  private cleanup = Promise.resolve();
  private retry: { cancel(): void } | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly platform: CompanionLivePlatform, private readonly backend?: CompanionClientController) {}

  readonly getSnapshot = (): CompanionLiveState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly start = async (target: CompanionLiveTarget, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted || this.attempt || this.platform.canStart?.() === false) return;
    this.cancelRetry();
    target = { ...target };
    this.target = target;
    this.setState({ ...EMPTY, hasStarted: true, status: 'connecting', targetDeviceId: target.id, targetName: target.name });
    // A launch request only owns the startup it initiated, never an existing call.
    const cancel = () => { if (this.target === target) void this.stop(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try { await this.connect(target, false); }
    finally { signal?.removeEventListener('abort', cancel); }
  };

  readonly resume = async (signal?: AbortSignal): Promise<void> => {
    if (this.target) await this.start(this.target, signal);
  };

  readonly stop = (): Promise<void> => {
    this.target = null;
    this.cancelRetry();
    this.endAttempt('stop');
    this.finishControls(false);
    this.setState({ status: 'idle', capturing: false, error: '', queued: 0, muted: false, playbackBlocked: false });
    return this.cleanup;
  };

  readonly pause = (): void => {
    if (!this.target || this.state.status === 'paused') return;
    this.cancelRetry();
    this.endAttempt('pause');
    this.finishControls(true);
    this.setState({ status: 'paused', capturing: false, queued: 0, muted: false, playbackBlocked: false });
  };

  readonly reset = (): void => { void this.stop(); this.setState(EMPTY); };
  readonly toggleMute = (): void => {
    if (!this.attempt?.connection) return;
    const muted = !this.state.muted;
    this.attempt.connection.mute(muted);
    this.setState({ muted });
  };
  readonly play = (): void => { void this.attempt?.connection?.play?.(); };
  readonly fail = (error: string): void => { this.setState({ status: 'error', error }); };

  private async connect(target: CompanionLiveTarget, reconnecting: boolean): Promise<void> {
    if (this.target !== target || this.attempt) return;
    if (this.platform.canStart?.() === false) { this.scheduleReconnect(target); return; }
    const previousCleanup = this.cleanup;
    const abort = new AbortController();
    let prepared!: () => void;
    const timing = new CompanionLiveTiming();
    const current = () => this.attempt === attempt;
    const update = (patch: Partial<CompanionLiveState>) => { if (current()) this.setState(patch); };
    const conversation = new CompanionLiveConversation({
      timing,
      externalBackendReplies: Boolean(this.backend),
      schedule: this.platform.schedule,
      runBackend: (prompt, telemetry) => target.run(prompt, abort.signal, telemetry),
      send: (event) => { if (current()) attempt.connection?.send(event); },
      onTranscript: (rows) => update({ captions: rows.map((row) => `${row.role === 'user' ? 'You' : 'Companion'}: ${row.text}`).join('\n') }),
      onQueue: (queued) => update({ queued }),
    });
    const attempt: Attempt = { abort, conversation, prepared: new Promise((resolve) => { prepared = resolve; }) };
    this.attempt = attempt;
    // Listen before cleanup/permissions, so completions during setup are buffered.
    attempt.replies = this.backend ? connectCompanionLiveReplies(this.backend, conversation) : undefined;
    try {
      await previousCleanup;
      if (!current()) return;
      await this.platform.prepare?.(abort.signal);
      if (!current()) return;
      attempt.connection = this.platform.createConnection({
        target, signal: abort.signal, timing, reconnecting,
        onEvent: (event) => { if (current()) conversation.receive(event); },
        onCapturing: () => update({ capturing: true }),
        onReady: (backendModel) => {
          if (!current()) return;
          this.reconnectAttempt = 0;
          attempt.replies?.ready();
          update({ status: 'listening', error: '', backendModel });
        },
        onError: (error) => {
          if (!current()) return;
          console.warn('[CompanionLive] Session failed', error);
          this.endAttempt('reconnect');
          this.scheduleReconnect(target);
        },
        onPlaybackBlocked: (playbackBlocked) => update({ playbackBlocked }),
        onStop: () => { if (current()) void this.stop(); },
      });
      prepared();
      if (this.state.muted) attempt.connection.mute(true);
      await attempt.connection.start();
    } catch (error) {
      if (current()) {
        console.warn('[CompanionLive] Session setup failed', error);
        this.endAttempt('reconnect');
        this.scheduleReconnect(target);
      }
    } finally { prepared(); if (!attempt.connection) timing.close(); }
  }

  private endAttempt(reason: CompanionLiveCloseReason): void {
    const attempt = this.attempt;
    this.attempt = null;
    if (!attempt) return;
    attempt.replies?.stop();
    attempt.conversation.stop();
    attempt.abort.abort();
    // Close remote/audio immediately; wait for native teardown before another start.
    const released = attempt.connection?.close(reason);
    this.cleanup = Promise.all([this.cleanup, attempt.prepared, released]).then(() => undefined).catch(() => undefined);
  }

  private finishControls(paused: boolean): void {
    const target = this.target;
    const released = this.cleanup;
    this.cleanup = Promise.all([released, this.platform.stopped?.(released, paused)]).then(() => undefined).catch(() => {
      if (paused && this.target === target && this.state.status === 'paused') void this.stop();
    });
  }

  private scheduleReconnect(target: CompanionLiveTarget): void {
    if (this.target !== target) return;
    this.retry?.cancel();
    this.setState({ status: 'connecting', capturing: false, error: '', queued: 0, playbackBlocked: false });
    const retry = { cancel: () => {} };
    this.retry = retry;
    retry.cancel = (this.platform.schedule ?? scheduleTimeout)(() => {
      if (this.retry !== retry || this.target !== target) return;
      this.retry = null;
      void this.connect(target, true);
    }, companionLiveReconnectDelay(this.reconnectAttempt++));
  }

  private cancelRetry(): void {
    this.retry?.cancel();
    this.retry = null;
    this.reconnectAttempt = 0;
  }

  private setState(patch: Partial<CompanionLiveState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

const EMPTY: CompanionLiveState = {
  hasStarted: false, status: 'idle', capturing: false, error: '', captions: '', queued: 0,
  muted: false, playbackBlocked: false, backendModel: '', targetDeviceId: '', targetName: '',
};

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}
