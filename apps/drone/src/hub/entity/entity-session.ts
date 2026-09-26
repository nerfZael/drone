import fs from 'node:fs';
import { chatChannel, Entity, keypadChannel, workspaceChannel, type EntityEvent, type EntitySnapshot, type Evaluator, type Mind } from '@entity/core';
import { droneRootPath } from '../../host/paths';
import { priceModelCall } from '../usage/priceModelCall';
import { fileConversationStore, PiAiMind, type ConversationStore, type ReasoningLevel } from './entity-mind';
import { createWorkSummarizer } from './entity-summarizer';
import type { EvaluatorKind } from './entity-evaluator';
import { EntityRecorder, isResumable, listSessions, readSession, type SessionMeta, type SessionRecording } from './entity-recorder';

export interface EntitySessionConfig {
  headModel: string;
  taskModel: string;
  /** A fast model that answers first, routes to workers and hands ongoing behaviour to the head; empty means the head is the front. */
  voiceModel: string;
  reasoning: ReasoningLevel;
  /** What backs `judge` / `sense`: Jev (billed per call through the AI Gateway), a small fast LLM, or nothing. Off by default. */
  evaluator: EvaluatorKind;
  /** Folder the workspace tools are confined to. Empty: a scratch folder in the Hub's data directory. */
  workspace: string;
  /** Let workers run shell commands in the workspace. Off by default: it runs LLM-written commands on this machine. */
  allowCommands: boolean;
  /** Work view summaries of busy workers, written by a cheap model. */
  summaries: boolean;
  /** Second looks at the front limb's answers: a separate reviewer on the head's model, the head itself, or none. */
  review: 'off' | 'separate' | 'head';
}

/** Where session recordings go: next to hub.log, so other agents on this machine can read them. */
export function defaultEntitySessionsDir(): string {
  return droneRootPath('entity-sessions');
}

export function defaultEntityWorkspace(): string {
  const dir = droneRootPath('entity-workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const DEFAULT_ENTITY_CONFIG: EntitySessionConfig = {
  headModel: 'openai-codex/gpt-6-luna',
  taskModel: 'openai-codex/gpt-6-sol',
  voiceModel: '',
  reasoning: 'medium',
  evaluator: 'off',
  workspace: '',
  allowCommands: false,
  summaries: true,
  review: 'separate',
};

export type EntityStreamMessage =
  | { kind: 'event'; event: EntityEvent }
  /** The snapshot sections that changed since the last one (and `t`). */
  | { kind: 'snapshot'; snapshot: Partial<EntitySnapshot> }
  | { kind: 'reset' }
  /** The whole state again, e.g. once Start has created the recording, so views learn its id. */
  | { kind: 'state' };

const MAX_BUFFERED_EVENTS = 2000;

/** The Hub's single entity test-bench session: one entity, its config, and live subscribers. */
export class EntitySession {
  private entity!: Entity;
  private config: EntitySessionConfig;
  private readonly listeners = new Set<(message: EntityStreamMessage) => void>();
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  /** Each snapshot section as last streamed. */
  private readonly sent = new Map<string, string>();
  private unsubscribe: (() => void) | null = null;
  private recorder: EntityRecorder | null = null;
  private readonly sessionsDir: string | null;

  constructor(
    private readonly createEvaluator: (kind: EvaluatorKind) => Evaluator | undefined,
    config: Partial<EntitySessionConfig> = {},
    /** `conversations` keeps worker conversations with the session's recording, so a resumed session continues them. */
    private readonly createMind: (config: EntitySessionConfig, conversations: ConversationStore) => Mind = (c, conversations) => new PiAiMind(c.reasoning, conversations, priceModelCall),
    /** Where to record sessions; null records nothing. */
    options: { sessionsDir?: string | null } = {},
  ) {
    this.sessionsDir = options.sessionsDir === undefined ? defaultEntitySessionsDir() : options.sessionsDir;
    this.config = { ...DEFAULT_ENTITY_CONFIG, ...config };
    this.build();
    this.resumeLatest();
  }

  /**
   * After a Hub restart, the newest session carries on where it stopped if the Hub closed or died while it ran.
   * It comes back paused; the user resumes it or resets. Sessions recorded before logs carried their setup cannot be.
   */
  private resumeLatest(): void {
    if (!this.sessionsDir) return;
    const latest = listSessions(this.sessionsDir, null)[0];
    if (!latest || !isResumable(latest)) return;
    const recording = readSession(this.sessionsDir, latest.id);
    if (!recording?.events.some(e => e.type === 'session_started' && e.data.setup)) return;
    this.config = { ...DEFAULT_ENTITY_CONFIG, ...(recording.meta.config as Partial<EntitySessionConfig>) };
    this.build();
    const entity = this.entity;
    try {
      this.recorder = new EntityRecorder(this.sessionsDir, { ...this.config }, () => entity.snapshot(), recording);
      entity.restore(recording.events);
    } catch (error) {
      console.warn('[entity] could not resume session', latest.id, error instanceof Error ? error.message : error);
      this.recorder?.finish('could not be resumed');
      this.recorder = null;
      this.config = { ...DEFAULT_ENTITY_CONFIG };
      this.build();
    }
  }

  /** Worker conversations live next to the current recording; with no recording, only in memory. */
  private readonly conversations: ConversationStore = {
    load: key => (this.recorder ? fileConversationStore(this.recorder.conversationsDir).load(key) : undefined),
    append: (key, messages) => { if (this.recorder) fileConversationStore(this.recorder.conversationsDir).append(key, messages); },
    remove: key => { if (this.recorder) fileConversationStore(this.recorder.conversationsDir).remove(key); },
  };

  private build(): void {
    this.unsubscribe?.();
    this.entity = new Entity({
      mind: this.createMind(this.config, this.conversations),
      channels: [chatChannel(), keypadChannel(), workspaceChannel({ root: this.config.workspace || defaultEntityWorkspace(), allowCommands: this.config.allowCommands })],
      config: { review: this.config.review },
      models: { head: this.config.headModel, task: this.config.taskModel, voice: this.config.voiceModel || undefined },
      evaluator: this.config.evaluator === 'off' ? undefined : this.createEvaluator(this.config.evaluator),
      summarizer: this.config.summaries ? createWorkSummarizer() : undefined,
    });
    this.unsubscribe = this.entity.subscribe(event => {
      if (event.type === 'session_reset') return;
      this.recorder?.record(event);
      this.broadcast({ kind: 'event', event });
      this.scheduleSnapshot();
    });
  }

  get status() { return this.entity.status; }
  getConfig(): EntitySessionConfig { return { ...this.config }; }

  state(): { config: EntitySessionConfig; snapshot: EntitySnapshot; events: EntityEvent[]; sessionId: string | null } {
    const all = this.entity.log.all();
    return { config: this.getConfig(), snapshot: this.entity.snapshot(), events: all.slice(-MAX_BUFFERED_EVENTS), sessionId: this.recorder?.id ?? null };
  }

  /** Recorded sessions, newest first, including the one running now. */
  sessions(): SessionMeta[] {
    return this.sessionsDir ? listSessions(this.sessionsDir, this.recorder?.id ?? null) : [];
  }

  /** A whole recorded session: the live one from memory, others from disk. */
  recording(id: string): SessionRecording | null {
    if (this.recorder?.id === id) return this.recorder.recording();
    return this.sessionsDir ? readSession(this.sessionsDir, id) : null;
  }

  get sessionsPath(): string | null { return this.sessionsDir; }

  control(action: 'start' | 'pause' | 'resume' | 'reset'): void {
    if (action === 'start' && this.entity.status === 'idle') {
      if (this.sessionsDir && !this.recorder) {
        const entity = this.entity;
        try { this.recorder = new EntityRecorder(this.sessionsDir, { ...this.config }, () => entity.snapshot()); }
        catch (error) { console.warn('[entity] session recording unavailable:', error instanceof Error ? error.message : error); }
      }
      this.entity.start();
      this.broadcast({ kind: 'state' });
    } else if (action === 'pause') this.entity.pause();
    else if (action === 'resume') this.entity.resume();
    else if (action === 'reset') {
      this.recorder?.finish('reset');
      this.recorder = null;
      this.entity.reset();
      this.broadcast({ kind: 'reset' });
    }
    this.scheduleSnapshot(0);
  }

  input(type: string, data: Record<string, unknown>): EntityEvent {
    return this.entity.input(type, data);
  }

  /** Work view actions on one worker. */
  worker(id: string, action: 'message' | 'stop' | 'rename', text = ''): string {
    if (action === 'rename') return this.entity.renameWorker(id, text);
    return action === 'message' ? this.entity.messageWorker(id, text) : this.entity.stopWorker(id);
  }

  /** The user overrides how a message was routed (the Work canvas's corrections). */
  reroute(seq: number, how: 'separate' | 'fork'): string {
    return this.entity.reroute(seq, how);
  }

  /** Config changes rebuild the entity, so they are only allowed before Start or after Reset. */
  configure(update: Partial<EntitySessionConfig>): EntitySessionConfig {
    if (this.entity.status !== 'idle') throw new Error('Reset the session before changing its configuration.');
    this.config = { ...this.config, ...update };
    this.entity.close();
    this.build();
    this.broadcast({ kind: 'reset' });
    this.scheduleSnapshot(0);
    return this.getConfig();
  }

  subscribe(listener: (message: EntityStreamMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.recorder?.finish('hub closed', 'suspended');
    this.recorder = null;
    this.entity.close();
    this.unsubscribe?.();
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
  }

  private broadcast(message: EntityStreamMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  private scheduleSnapshot(delay = 150): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      // Only what changed: a client has the full state from when it connected, and every patch since.
      const snapshot = this.entity.snapshot();
      const patch: Partial<EntitySnapshot> = { t: snapshot.t };
      for (const [key, value] of Object.entries(snapshot)) {
        if (key === 't') continue;
        const json = JSON.stringify(value);
        if (this.sent.get(key) === json) continue;
        this.sent.set(key, json);
        (patch as Record<string, unknown>)[key] = value;
      }
      this.broadcast({ kind: 'snapshot', snapshot: patch });
    }, delay);
  }
}
