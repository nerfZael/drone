import fs from 'node:fs';
import path from 'node:path';
import { chatChannel, Entity, keypadChannel, workspaceChannel, type EntityEvent, type EntitySnapshot, type Evaluator, type Mind } from '@entity/core';
import { droneRootPath } from '../../host/paths';
import { priceModelCall } from '../usage/priceModelCall';
import { fileConversationStore, PiAiMind, type ConversationStore } from './entity-mind';
import { isReasoning, type EntityModels } from './entity-profiles';
import { createWorkSummarizer, SUMMARY_PROMPT } from './entity-summarizer';
import type { EntityPrompts } from './entity-prompts';
import type { EvaluatorKind } from './entity-evaluator';
import { EntityRecorder, isResumable, listSessions, readSession, type SessionMeta, type SessionRecording } from './entity-recorder';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog } from '@drone/assistant-chat';
import { EMPTY_WORKSPACE_ACCESS, EntityWorkspaces, workspacesChannel, workspaceView, type CreateWorkspaceService } from './entity-workspaces';

export interface EntitySessionConfig {
  /**
   * The model and reasoning level for each part: the head (and the reviewer, which uses the head's), workers, and the
   * voice, a fast model that answers first, routes to workers and hands ongoing behaviour to the head (null: the head is
   * the front).
   */
  models: EntityModels;
  /** What backs `judge` / `sense`: Jev (billed per call through the AI Gateway), a small fast LLM, or nothing. Off by default. */
  evaluator: EvaluatorKind;
  /** The entity's home folder, always available to it. Empty: a scratch folder in the Hub's data directory. */
  workspace: string;
  /**
   * The workspaces the session may use besides its home, and what each allows (read, write, run commands): the same
   * selection the Companion's workspace picker makes, kept per session. Changes apply from the next tool call.
   */
  workspaceAccess: ChatWorkspaceAccess;
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
  models: {
    head: { model: 'openai-codex/gpt-6-luna', reasoning: 'medium' },
    task: { model: 'openai-codex/gpt-6-sol', reasoning: 'medium' },
    voice: null,
  },
  evaluator: 'off',
  workspace: '',
  workspaceAccess: EMPTY_WORKSPACE_ACCESS,
  summaries: true,
  review: 'separate',
};

/** A config as saved in a recording, from before `models` too: the flat model fields with one reasoning level. */
export function entityConfigFrom(saved: Record<string, unknown> | undefined): EntitySessionConfig {
  const { headModel, taskModel, voiceModel, reasoning, ...rest } = (saved ?? {}) as Record<string, any>;
  const config = { ...DEFAULT_ENTITY_CONFIG, ...rest } as EntitySessionConfig;
  if (!saved?.models && typeof headModel === 'string') {
    const level = isReasoning(reasoning) ? reasoning : 'medium';
    config.models = {
      head: { model: headModel, reasoning: level },
      task: { model: typeof taskModel === 'string' ? taskModel : headModel, reasoning: level },
      voice: typeof voiceModel === 'string' && voiceModel ? { model: voiceModel, reasoning: level } : null,
    };
  }
  return config;
}

/** The reasoning level for one mind run: the voice's, the head's (reviewer too), or a worker's by the model it runs on. */
export function reasoningFor(models: EntityModels, input: { role: 'head' | 'voice' | 'task'; model: string }) {
  if (input.role === 'voice' && models.voice) return models.voice.reasoning;
  if (input.role === 'head') return models.head.reasoning;
  // A worker dispatched on the head's model thinks like the head.
  if (input.role === 'task' && input.model !== models.task.model && input.model === models.head.model) return models.head.reasoning;
  return models.task.reasoning;
}

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
  /** The session's workspaces, when the Hub provides the Companion's workspace service; else only a local folder. */
  private workspaces: EntityWorkspaces | null = null;
  private readonly createWorkspaceService?: CreateWorkspaceService;
  private readonly workspaceDefinitions?: { name: string; description: string; parameters: Record<string, unknown> }[];
  private readonly prompts?: EntityPrompts;

  constructor(
    private readonly createEvaluator: (kind: EvaluatorKind) => Evaluator | undefined,
    config: Partial<EntitySessionConfig> = {},
    /** `conversations` keeps worker conversations with the session's recording, so a resumed session continues them. */
    private readonly createMind: (config: EntitySessionConfig, conversations: ConversationStore) => Mind = (c, conversations) => new PiAiMind(input => reasoningFor(c.models, input), conversations, priceModelCall),
    /**
     * Where to record sessions (null records nothing), and the workspace service with blip's tool definitions: with
     * them the entity works across the workspaces its session selects, without them only in its home folder.
     */
    options: {
      sessionsDir?: string | null;
      createWorkspaceService?: CreateWorkspaceService;
      workspaceDefinitions?: { name: string; description: string; parameters: Record<string, unknown> }[];
      /** The user's prompt edits, read on every wake. */
      prompts?: EntityPrompts;
    } = {},
  ) {
    this.prompts = options.prompts;
    this.sessionsDir = options.sessionsDir === undefined ? defaultEntitySessionsDir() : options.sessionsDir;
    this.createWorkspaceService = options.createWorkspaceService;
    this.workspaceDefinitions = options.workspaceDefinitions;
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
    this.config = entityConfigFrom(recording.meta.config as Record<string, unknown>);
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
    const home = () => this.config.workspace || defaultEntityWorkspace();
    this.workspaces = this.createWorkspaceService && this.workspaceDefinitions
      ? new EntityWorkspaces(this.createWorkspaceService, this.config.workspaceAccess, home, () => `entity:${this.recorder?.id ?? 'unrecorded'}`, access => this.workspacesChanged(access))
      : null;
    this.entity = new Entity({
      mind: this.createMind(this.config, this.conversations),
      channels: [
        chatChannel({ checkFiles: paths => this.checkFiles(home(), paths) }), keypadChannel(),
        this.workspaces ? workspacesChannel(this.workspaces, this.workspaceDefinitions!) : workspaceChannel({ root: home() }),
      ],
      config: { review: this.config.review },
      models: { head: this.config.models.head.model, task: this.config.models.task.model, voice: this.config.models.voice?.model },
      evaluator: this.config.evaluator === 'off' ? undefined : this.createEvaluator(this.config.evaluator),
      summarizer: this.config.summaries ? createWorkSummarizer(undefined, () => this.prompts?.text('hub_work_summaries') ?? SUMMARY_PROMPT) : undefined,
      prompts: () => this.prompts?.current() ?? {},
      artifactsFolder: () => this.artifactsFolder(),
      overflow: (limbId, text) => this.saveOverflow(home(), limbId, text),
    });
    this.unsubscribe = this.entity.subscribe(event => {
      if (event.type === 'session_reset') return;
      this.recorder?.record(event);
      this.broadcast({ kind: 'event', event });
      this.scheduleSnapshot();
    });
  }

  /** Where this session's workers keep their artifacts, relative to the home folder: one folder per recorded session. */
  private artifactsFolder(): string {
    return `.entity/artifacts/${this.recorder?.id ?? 'unrecorded'}`;
  }

  /** Files a chat message links must be in the home folder and exist. */
  private checkFiles(root: string, paths: string[]): string | null {
    for (const p of paths) {
      const full = path.resolve(root, p);
      const inside = path.relative(root, full);
      if (inside.startsWith('..') || path.isAbsolute(inside)) return `${p} is outside your home folder; link files in your home folder only`;
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return `${p} does not exist in your home folder`;
    }
    return null;
  }

  /** A worker's message that stayed too long for the chat, saved as a file so nothing is lost. */
  private saveOverflow(root: string, limbId: string, text: string): string | null {
    try {
      const name = (this.entity.snapshot().limbs.find(l => l.id === limbId)?.name ?? limbId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || limbId;
      const folder = this.artifactsFolder();
      fs.mkdirSync(path.join(root, folder), { recursive: true });
      let file = `${folder}/${name}.md`;
      for (let n = 2; fs.existsSync(path.join(root, file)); n++) file = `${folder}/${name}-${n}.md`;
      fs.writeFileSync(path.join(root, file), `${text}\n`);
      return file;
    } catch {
      return null;
    }
  }

  /** A saved selection: kept in the config and the recording, and told to the entity so its limbs (and a replay) see it. */
  private workspacesChanged(access: ChatWorkspaceAccess): void {
    this.config = { ...this.config, workspaceAccess: access };
    this.recorder?.updateConfig({ ...this.config });
    this.entity.hostEvent('workspaces_changed', { access: workspaceView(access) as unknown as Record<string, unknown> });
    this.broadcast({ kind: 'state' });
    this.scheduleSnapshot();
  }

  /** The workspace picker's catalog and saves, for this session. */
  workspaceCatalog(deviceId?: string): Promise<ChatWorkspaceCatalog> {
    if (!this.workspaces) return Promise.reject(new Error('Workspaces are not available in this Hub'));
    return this.workspaces.catalog(deviceId);
  }

  saveWorkspaces(value: unknown, revision: string): Promise<ChatWorkspaceCatalog> {
    if (!this.workspaces) return Promise.reject(new Error('Workspaces are not available in this Hub'));
    return this.workspaces.save(value, revision);
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
  worker(id: string, action: 'message' | 'stop' | 'rename', text = '', answers?: number): string {
    if (action === 'rename') return this.entity.renameWorker(id, text);
    return action === 'message' ? this.entity.messageWorker(id, text, answers) : this.entity.stopWorker(id);
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
