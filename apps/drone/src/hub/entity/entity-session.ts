import fs from 'node:fs';
import { chatChannel, Entity, keypadChannel, workspaceChannel, type EntityEvent, type EntitySnapshot, type Evaluator, type Mind } from '@entity/core';
import { droneRootPath } from '../../host/paths';
import { PiAiMind, type ReasoningLevel } from './entity-mind';
import type { EvaluatorKind } from './entity-evaluator';
import { EntityRecorder, listSessions, readSession, type SessionMeta, type SessionRecording } from './entity-recorder';

export interface EntitySessionConfig {
  headModel: string;
  taskModel: string;
  /** A fast model that answers first and hands off to the head; empty means the head is the voice. */
  voiceModel: string;
  reasoning: ReasoningLevel;
  /** What backs `judge` / `sense`: Jev (billed per call through the AI Gateway), a small fast LLM, or nothing. Off by default. */
  evaluator: EvaluatorKind;
  /** Parallel conversation: every message gets a capable worker at once. */
  parallel: boolean;
  /** Folder the workspace tools are confined to. Empty: a scratch folder in the Hub's data directory. */
  workspace: string;
  /** Let workers run shell commands in the workspace. Off by default: it runs LLM-written commands on this machine. */
  allowCommands: boolean;
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
  parallel: false,
  workspace: '',
  allowCommands: false,
};

export type EntityStreamMessage =
  | { kind: 'event'; event: EntityEvent }
  | { kind: 'snapshot'; snapshot: EntitySnapshot }
  | { kind: 'reset' };

const MAX_BUFFERED_EVENTS = 2000;

/** The Hub's single entity test-bench session: one entity, its config, and live subscribers. */
export class EntitySession {
  private entity!: Entity;
  private config: EntitySessionConfig;
  private readonly listeners = new Set<(message: EntityStreamMessage) => void>();
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private recorder: EntityRecorder | null = null;
  private readonly sessionsDir: string | null;

  constructor(
    private readonly createEvaluator: (kind: EvaluatorKind) => Evaluator | undefined,
    config: Partial<EntitySessionConfig> = {},
    private readonly createMind: (config: EntitySessionConfig) => Mind = c => new PiAiMind(c.reasoning),
    /** Where to record sessions; null records nothing. */
    options: { sessionsDir?: string | null } = {},
  ) {
    this.sessionsDir = options.sessionsDir === undefined ? defaultEntitySessionsDir() : options.sessionsDir;
    this.config = { ...DEFAULT_ENTITY_CONFIG, ...config };
    this.build();
  }

  private build(): void {
    this.unsubscribe?.();
    this.entity = new Entity({
      mind: this.createMind(this.config),
      channels: [chatChannel(), keypadChannel(), workspaceChannel({ root: this.config.workspace || defaultEntityWorkspace(), allowCommands: this.config.allowCommands })],
      config: { parallel: this.config.parallel },
      models: { head: this.config.headModel, task: this.config.taskModel, voice: this.config.voiceModel || undefined },
      evaluator: this.config.evaluator === 'off' ? undefined : this.createEvaluator(this.config.evaluator),
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
    this.recorder?.finish('hub closed');
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
      this.broadcast({ kind: 'snapshot', snapshot: this.entity.snapshot() });
    }, delay);
  }
}
