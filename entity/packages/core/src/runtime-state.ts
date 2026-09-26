import { isEntityActor } from './log.js';

export { isEntityActor };
import type { EntityEvent } from './types.js';
import type { StopMode, StopScope, WatchSpec } from './watch.js';

/**
 * The runtime's own state (limbs, claims, stops, batches, review, notes) as a pure projection of the event log.
 * `reduceRuntime` is the only thing that changes it, so replaying a log rebuilds it exactly: the basis for
 * replay and resumable sessions. What cannot live in a log (abort controllers, timers, sandboxes, rate
 * limits) stays in the Entity. See entity/docs/core-model.md.
 */

export type LimbRole = 'head' | 'voice' | 'reviewer' | 'task' | 'watch' | 'program';
/** A worker is `waiting` while it waits for another worker to finish (dispatch with `after`), and `queued` while it waits for a free slot. */
export type LimbStatus = 'idle' | 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'killed';

export interface RunState { id: string; reason: string; startedAt: number; readSeq: number; firstToolAt?: number }

interface LimbBase {
  id: string;
  name: string;
  parent?: string;
  status: LimbStatus;
  createdAt: number;
  /** When an LLM decided to start this (a tool call; for a program a watch launched, when the watch was decided). Output stops issued before then do not cover it. */
  decidedAt?: number;
  /** When a worker or code limb stopped running. */
  endedAt?: number;
}

interface LlmBase extends LimbBase {
  kind: 'llm';
  model: string;
  /** Runs in flight, and the newest one: older runs of a limb are superseded. */
  runs: RunState[];
  latestRun?: string;
  /** Log position up to which this limb has already been shown events. */
  seenSeq: number;
  lastRunAt?: number;
  crashes: number[];
  /** What its model runs have used so far (cost in USD, when the provider reports it). */
  usage: Usage;
}

/** Token totals (input without cache; output with reasoning) and their cost in USD at list price; `unpriced` calls had no known price. */
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; unpriced: number }

/** Adds one call's usage to a total. */
export function addUsage(total: Usage, used: { input?: number | null; output?: number | null; cacheRead?: number | null; cacheWrite?: number | null; cost?: number | null }): void {
  total.input += used.input ?? 0;
  total.output += used.output ?? 0;
  total.cacheRead += used.cacheRead ?? 0;
  total.cacheWrite += used.cacheWrite ?? 0;
  if (typeof used.cost === 'number') total.cost += used.cost; else total.unpriced++;
}

/** The head, the voice and the reviewer: permanent, and fresh on every wake. */
export interface ReactiveLimb extends LlmBase { role: 'head' | 'voice' | 'reviewer' }

/** One piece of the user's work, with a conversation of its own. */
export interface WorkerLimb extends LlmBase {
  role: 'task';
  task: string;
  /** The user message it answers, the worker it waits for, and its batch (dispatch_many). */
  replyTo?: number;
  waitFor?: string;
  group?: string;
  /** Where it came from: the worker it was forked from, and the one it was dispatched to wait for. */
  forkOf?: string;
  after?: string;
  /** The worker holding a file its last write needed; cleared by its next successful tool call. */
  blockedBy?: { limb: string; path: string };
  /** The message where it asked the user something it needs to go on; it waits for the answer. */
  asking?: number;
  result?: string;
  /** Updates it gets with its next tool result or wake, and steers queued for when it finishes. */
  notices: string[];
  later: string[];
  /** Times it was continued after running out of turns. */
  continuations: number;
  cancelRequested?: boolean;
}

interface CodeBase extends LimbBase {
  kind: 'code';
  /** A few words saying what it does. */
  label?: string;
}

export interface WatchLimb extends CodeBase {
  role: 'watch';
  watch: WatchSpec;
  fires: number;
  expiresAt?: number;
  /** Installed by the runtime itself; limbs cannot cancel it. */
  builtin?: boolean;
}

export interface ProgramLimb extends CodeBase { role: 'program'; code: string }

export type LlmLimb = ReactiveLimb | WorkerLimb;
export type CodeLimb = WatchLimb | ProgramLimb;
export type LimbState = LlmLimb | CodeLimb;

export interface Claim { path: string; limb: string; note: string; since: number }

export interface OutputStop { id: string; owner: string; scope: StopScope; mode: StopMode; reason: string; since: number; by: string }

export interface Batch { title: string; message?: number; text?: string; ended: boolean }

/** What a session is set up with, logged on `session_started` so a log replays on its own. */
export interface RuntimeSetup {
  models: { head: string; task: string; voice?: string };
  review: 'off' | 'separate' | 'head';
  codeLimbs: boolean;
  /** Most finished worker conversations kept for forks and follow-ups. */
  keptSessions: number;
}

export interface RuntimeState {
  setup: RuntimeSetup;
  limbs: Record<string, LimbState>;
  claims: Record<string, Claim>;
  stops: OutputStop[];
  notes: string[];
  discoveries: { by: string; text: string; t: number }[];
  batches: Record<string, Batch>;
  /** Answers of the front limb waiting for a second look, and the ones a review run is on. */
  unreviewed: number[];
  reviewing: number[];
  /** Finished workers whose conversation is kept, oldest first. */
  kept: string[];
  health: { t: number; message: string }[];
  /** When the latest event of each type happened: `any:<type>`, `user:<type>`, `entity:<type>`. */
  lastEvents: Record<string, number>;
  /** Highest number used in an id (worker-N, run-N, stop-N ...), so new ids never collide. */
  counter: number;
  /** Timers set with set_timer and not fired yet. `due` is in running time: session time minus time spent paused. */
  timers: { id: string; label: string; limb: string; due: number }[];
  /** Time spent paused so far, and since when the session is paused now. */
  pausedMs: number;
  pausedSince?: number;
  /** What every model call in the session has used, and the part of it that went to work summaries and senses (Jev). */
  usage: Usage;
  usageBy: { summaries: Usage; senses: Usage };
}

/** A limb as views see it: one flat shape for every kind. */
export interface LimbSnapshot {
  id: string; kind: 'llm' | 'code'; role: LimbRole; name: string; parent?: string; model?: string; status: LimbStatus;
  runs: { id: string; reason: string; startedAt: number; firstToolAt?: number }[];
  task?: string; result?: string; watch?: WatchSpec; code?: string; fires?: number; label?: string; group?: string;
  createdAt: number; endedAt?: number; replyTo?: number; waitFor?: string; claims: string[];
  forkOf?: string; after?: string; blockedBy?: { limb: string; path: string }; asking?: number; usage?: Usage;
}

/** The limbs as views show them, from the runtime state alone. */
export function snapshotLimbs(state: RuntimeState): LimbSnapshot[] {
  const claims = Object.values(state.claims);
  return Object.values(state.limbs).map(l => ({
    id: l.id, kind: l.kind, role: l.role, name: l.name, parent: l.parent, status: l.status, createdAt: l.createdAt, endedAt: l.endedAt,
    claims: claims.filter(c => c.limb === l.id).map(c => c.path),
    runs: l.kind === 'llm' ? l.runs.map(r => ({ id: r.id, reason: r.reason, startedAt: r.startedAt, firstToolAt: r.firstToolAt })) : [],
    ...(l.kind === 'llm' ? { model: l.model, usage: { ...l.usage } } : { label: l.label }),
    ...(l.role === 'task' ? {
      task: l.task, result: l.result, group: l.group, replyTo: l.replyTo, waitFor: l.waitFor,
      forkOf: l.forkOf, after: l.after, blockedBy: l.blockedBy, asking: l.asking,
    } : {}),
    ...(l.role === 'watch' ? { watch: l.watch, fires: l.fires } : {}),
    ...(l.role === 'program' ? { code: l.code } : {}),
  }));
}

export const WORKER_ACTIVE: readonly LimbStatus[] = ['running', 'queued', 'waiting'];

const noUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 });
const llm = (init: Pick<LlmBase, 'id' | 'name' | 'model' | 'status' | 'createdAt'> & Partial<LlmBase>) => ({ kind: 'llm' as const, runs: [], seenSeq: 0, crashes: [], usage: noUsage(), ...init });

export function initialRuntimeState(setup: RuntimeSetup): RuntimeState {
  const limbs: Record<string, LimbState> = { head: { ...llm({ id: 'head', name: 'head', model: setup.models.head, status: 'idle', createdAt: 0 }), role: 'head' } };
  if (setup.review === 'separate') limbs.reviewer = { ...llm({ id: 'reviewer', name: 'reviewer', parent: 'head', model: setup.models.head, status: 'idle', createdAt: 0 }), role: 'reviewer' };
  if (setup.models.voice) limbs.voice = { ...llm({ id: 'voice', name: 'voice', parent: 'head', model: setup.models.voice, status: 'idle', createdAt: 0 }), role: 'voice' };
  return { setup, limbs, claims: {}, stops: [], notes: [], discoveries: [], batches: {}, unreviewed: [], reviewing: [], kept: [], health: [], lastEvents: {}, counter: 0, timers: [], pausedMs: 0, usage: noUsage(), usageBy: { summaries: noUsage(), senses: noUsage() } };
}

/** Rebuilds the runtime state from a log. */
export function replayRuntime(events: readonly EntityEvent[], setup?: RuntimeSetup): RuntimeState {
  const first = events.find(e => e.type === 'session_started')?.data.setup as RuntimeSetup | undefined;
  const state = initialRuntimeState(setup ?? first ?? { models: { head: '', task: '' }, review: 'off', codeLimbs: true, keptSessions: 12 });
  for (const event of events) reduceRuntime(state, event);
  return state;
}

/** The text a worker gets for a steer. */
export const steerNote = (by: string, text: string) => by === 'user' ? `Message from the user: ${text}` : `Message from the user (via ${by}): ${text}`;

const ID_NUMBER = /-(\d+)$/;
const push = <T>(list: T[], item: T, max: number) => { list.push(item); if (list.length > max) list.splice(0, list.length - max); };
const str = (value: unknown) => (value === undefined || value === null ? undefined : String(value));

/** Applies one event to the runtime state, in place. Pure otherwise: it reads nothing but the state and the event. */
export function reduceRuntime(state: RuntimeState, event: EntityEvent): void {
  const { data, by, t } = event;
  state.lastEvents[`any:${event.type}`] = t;
  if (by === 'user') state.lastEvents[`user:${event.type}`] = t;
  else if (isEntityActor(by)) state.lastEvents[`entity:${event.type}`] = t;
  for (const key of ['id', 'run']) {
    const n = typeof data[key] === 'string' ? ID_NUMBER.exec(data[key] as string)?.[1] : undefined;
    if (n) state.counter = Math.max(state.counter, Number(n));
  }
  const limb = (id: unknown) => (typeof id === 'string' ? state.limbs[id] : undefined);
  const worker = (id: unknown) => { const l = limb(id); return l?.role === 'task' ? l : undefined; };
  const code = (id: unknown) => { const l = limb(id); return l?.kind === 'code' ? l : undefined; };
  const self = limb(by);
  const selfLlm = self?.kind === 'llm' ? self : undefined;
  const selfWorker = worker(by);
  /** Updates for every other running worker. */
  const notify = (text: string) => { for (const l of Object.values(state.limbs)) if (l.role === 'task' && l.status === 'running' && l.id !== by) l.notices.push(text); };

  switch (event.type) {
    case 'session_started': {
      const setup = data.setup as RuntimeSetup | undefined;
      if (setup) Object.assign(state, initialRuntimeState(setup), { lastEvents: state.lastEvents, counter: state.counter });
      return;
    }
    case 'session_paused':
      state.pausedSince = t;
      return;
    case 'session_resumed':
      state.pausedMs += Number(data.paused_for_ms ?? 0);
      state.pausedSince = undefined;
      return;
    case 'timer_set':
      state.timers.push({ id: String(data.id), label: String(data.label), limb: String(data.limb), due: t - state.pausedMs + Number(data.after_ms) });
      return;
    case 'timer':
      state.timers = state.timers.filter(timer => timer.id !== data.id);
      return;
    case 'run_started': {
      if (!selfLlm) return;
      selfLlm.runs.push({ id: String(data.run), reason: String(data.reason), startedAt: t, readSeq: event.seq - 1 });
      selfLlm.latestRun = String(data.run);
      selfLlm.seenSeq = event.seq - 1;
      selfLlm.lastRunAt = t;
      if (selfWorker && typeof data.notices === 'number') selfWorker.notices.splice(0, data.notices);
      return;
    }
    case 'run_finished': {
      if (!selfLlm) return;
      selfLlm.runs = selfLlm.runs.filter(r => r.id !== data.run);
      const used = data.usage as Parameters<typeof addUsage>[1] | null | undefined;
      if (used) { addUsage(selfLlm.usage, used); addUsage(state.usage, used); }
      return;
    }
    case 'usage': {
      // Model calls outside the limbs: work summaries and senses.
      const bucket = data.kind === 'summaries' || data.kind === 'senses' ? state.usageBy[data.kind] : undefined;
      if (bucket) addUsage(bucket, data);
      addUsage(state.usage, data);
      return;
    }
    case 'tool_called': {
      const run = selfLlm?.runs.find(r => r.id === data.run);
      if (run) run.firstToolAt ??= t;
      return;
    }
    case 'tool_done':
      if (!selfWorker) return;
      if (typeof data.notices === 'number') selfWorker.notices.splice(0, data.notices);
      if (data.ok) selfWorker.blockedBy = undefined;
      return;
    case 'write_refused':
      if (selfWorker) selfWorker.blockedBy = { limb: String(data.holder), path: String(data.path) };
      return;
    case 'limb_renamed': {
      const target = limb(data.id);
      if (target) target.name = String(data.name);
      return;
    }
    case 'limb_failed':
      if (!selfLlm) return;
      push(selfLlm.crashes, t, 10);
      // A retry is shown again the events the failed run was shown.
      if (typeof data.shown_from === 'number') selfLlm.seenSeq = Math.min(selfLlm.seenSeq, data.shown_from);
      return;
    case 'limb_spawned': {
      const status = (str(data.status) ?? (data.queued ? 'queued' : 'running')) as LimbStatus;
      state.limbs[String(data.id)] = {
        ...llm({ id: String(data.id), name: String(data.name), parent: 'head', model: String(data.model), status, createdAt: t, decidedAt: t }),
        role: 'task', task: String(data.task), replyTo: typeof data.reply_to === 'number' ? data.reply_to : undefined,
        waitFor: status === 'waiting' ? str(data.after) : undefined, group: str(data.group),
        forkOf: str(data.fork_of), after: str(data.after),
        notices: [], later: [], continuations: 0,
        // What happened before it existed is in its state and task, not news to it.
        seenSeq: event.seq,
      };
      return;
    }
    case 'limb_started': {
      const target = worker(data.id);
      if (target) { target.status = 'running'; target.waitFor = undefined; }
      return;
    }
    case 'limb_queued': {
      const target = worker(data.id);
      if (!target) return;
      target.status = 'queued';
      target.waitFor = undefined;
      if (data.note) target.notices.push(String(data.note));
      return;
    }
    case 'limb_revived': {
      const target = worker(data.id);
      if (!target) return;
      target.status = 'running';
      target.endedAt = undefined;
      // Work queued for after it finished becomes its next update.
      if (data.later) target.notices.push(...target.later.splice(0));
      if (typeof data.reply_to === 'number') target.replyTo = data.reply_to;
      return;
    }
    case 'task_continued':
      if (selfWorker) selfWorker.continuations = Number(data.continuations);
      return;
    case 'cancel_requested': {
      const target = worker(data.id);
      if (target) target.cancelRequested = true;
      return;
    }
    case 'task_done': {
      if (!selfWorker) return;
      selfWorker.status = data.status as LimbStatus;
      selfWorker.endedAt = t;
      selfWorker.result = String(data.result ?? '');
      selfWorker.blockedBy = undefined;
      selfWorker.asking = undefined;
      state.kept = state.kept.filter(id => id !== selfWorker.id);
      if (selfWorker.status === 'done') {
        state.kept.push(selfWorker.id);
        if (state.kept.length > state.setup.keptSessions) state.kept.splice(0, state.kept.length - state.setup.keptSessions);
      }
      return;
    }
    case 'steered': {
      const target = worker(data.id);
      if (!target) return;
      const note = steerNote(by, String(data.text));
      // A message for a worker that asked the user something is taken as the answer.
      target.asking = undefined;
      if (data.when === 'after' && WORKER_ACTIVE.includes(target.status)) target.later.push(note);
      else target.notices.push(note);
      return;
    }
    case 'rerouted': {
      const target = worker(data.from);
      if (target && WORKER_ACTIVE.includes(target.status)) {
        target.notices.push(`The user moved their message "${String(data.text ?? '').slice(0, 200)}" to a separate worker: leave that part to it and carry on with the rest.`);
      }
      return;
    }
    case 'claimed': {
      const path = String(data.path);
      state.claims[path] = { path, limb: by, note: String(data.note ?? ''), since: t };
      notify(`${by} claimed ${path}${data.note ? ` (${data.note})` : ''}`);
      return;
    }
    case 'released':
      for (const path of (data.paths as string[] | undefined) ?? []) if (state.claims[path]?.limb === by) delete state.claims[path];
      return;
    case 'discovery':
      push(state.discoveries, { by, text: String(data.text), t }, 20);
      notify(`${by} shares: ${data.text}`);
      return;
    case 'group_started':
      state.batches[String(data.id)] = { title: String(data.title), ended: false };
      return;
    case 'group_extended': {
      const batch = state.batches[String(data.id)];
      if (batch) batch.ended = false;
      return;
    }
    case 'group_finished': {
      const batch = state.batches[String(data.id)];
      if (batch) batch.ended = true;
      return;
    }
    case 'chat_message': {
      if (selfWorker && data.question) selfWorker.asking = event.seq;
      const batch = typeof data.group === 'string' ? state.batches[data.group] : undefined;
      if (batch && batch.message === undefined) { batch.message = event.seq; batch.text = String(data.text); }
      return;
    }
    case 'chat_message_updated': {
      const batch = typeof data.group === 'string' ? state.batches[data.group] : undefined;
      if (batch) batch.text = String(data.text);
      return;
    }
    case 'output_stopped':
      state.stops.push({ id: String(data.id), owner: String(data.owner), scope: data.scope as StopScope, mode: data.mode as StopMode, reason: String(data.reason), since: t, by });
      return;
    case 'output_resumed': {
      const ids = (data.ids as string[] | undefined) ?? [];
      state.stops = state.stops.filter(s => !ids.includes(s.id));
      return;
    }
    case 'note':
      push(state.notes, String(data.text), 20);
      return;
    case 'health':
      push(state.health, { t, message: String(data.message) }, 50);
      return;
    case 'watch_installed': {
      const watch = data.watch as unknown as WatchSpec;
      state.limbs[String(data.id)] = {
        id: String(data.id), kind: 'code', role: 'watch', name: String(data.name), parent: by, status: 'running', createdAt: t,
        decidedAt: typeof data.decided_at === 'number' ? data.decided_at : undefined, watch, label: watch.label, fires: 0,
        builtin: data.builtin === true || undefined, expiresAt: watch.expires_s ? t + watch.expires_s * 1000 : undefined,
      };
      return;
    }
    case 'program_started':
      state.limbs[String(data.id)] = {
        id: String(data.id), kind: 'code', role: 'program', name: String(data.name), parent: by, status: 'running', createdAt: t,
        decidedAt: typeof data.decided_at === 'number' ? data.decided_at : undefined, code: String(data.code), label: str(data.label),
      };
      return;
    case 'watch_fired': {
      const target = limb(data.id);
      if (target?.role === 'watch') target.fires++;
      return;
    }
    case 'watch_removed':
    case 'program_finished':
    case 'program_failed':
    case 'program_cancelled': {
      const target = code(data.id);
      if (!target) return;
      target.status = (str(data.status) ?? (event.type === 'program_finished' ? 'done' : event.type === 'program_failed' ? 'failed' : 'cancelled')) as LimbStatus;
      target.endedAt = t;
      return;
    }
    case 'review_queued':
      state.unreviewed.push(Number(data.seq));
      return;
    case 'review_started': {
      const seqs = (data.seqs as number[]) ?? [];
      state.unreviewed = state.unreviewed.filter(s => !seqs.includes(s));
      state.reviewing.push(...seqs);
      return;
    }
    case 'review_requeued': {
      const seqs = (data.seqs as number[]) ?? [];
      state.reviewing = state.reviewing.filter(s => !seqs.includes(s));
      state.unreviewed.unshift(...seqs);
      return;
    }
    case 'message_reviewed': {
      const seq = Number(data.seq);
      state.reviewing = state.reviewing.filter(s => s !== seq);
      state.unreviewed = state.unreviewed.filter(s => s !== seq);
      return;
    }
  }
}
