import fs from 'node:fs';
import path from 'node:path';
import type { EntityEvent, EntitySnapshot } from '@entity/core';

/**
 * Session recording for the entity bench: every event, plus snapshot frames, on disk under the
 * Hub's data directory so the bench can replay a session and other agents can read it.
 * The format is described in sessions-readme below (written next to the sessions) and in
 * entity/docs/session-logs.md.
 */

/**
 * Snapshot sections a frame carries. `t` travels on the frame itself. Limbs, stops, notes and health are not
 * recorded: the log rebuilds them (`replayRuntime` from `@entity/core/state`). Recordings made before that carry them too.
 */
const SECTIONS = ['status', 'world', 'levels', 'senses', 'jev'] as const;
type Section = (typeof SECTIONS)[number] | 'self' | 'stops' | 'health' | 'limbs';
/**
 * The runtime reduces these into state before it notifies listeners, so they are exact at every
 * event. Senses and Jev stats settle while the runtime handles the event, so they are captured
 * once it has finished the turn.
 */
const PER_EVENT: readonly Section[] = ['world', 'levels'];

/** The snapshot after event `seq`: only the sections that changed since the previous frame. */
export interface SnapshotFrame { seq: number; t: number; patch: Partial<Pick<EntitySnapshot, Section>> }

/** `suspended`: the Hub closed while it ran; `interrupted`: the Hub stopped without closing it. Both can be resumed. */
export type SessionStatus = 'live' | 'ended' | 'interrupted' | 'suspended';

export interface SessionMeta {
  id: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  config: Record<string, unknown>;
  events: number;
  frames: number;
  /** The user's first chat message, to tell sessions apart in a list. */
  firstMessage?: string;
}

export interface SessionRecording { meta: SessionMeta; events: EntityEvent[]; frames: SnapshotFrame[] }

const KEEP_SESSIONS = 200;
const ID_PATTERN = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

export const isSessionId = (id: string) => ID_PATTERN.test(id);

function newSessionId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

export const isResumable = (meta: SessionMeta) => meta.status === 'interrupted' || meta.status === 'suspended';

/** Records one entity session, from Start until Reset, across Hub restarts when the session is resumed. */
export class EntityRecorder {
  readonly meta: SessionMeta;
  readonly dir: string;
  readonly events: EntityEvent[] = [];
  readonly frames: SnapshotFrame[] = [];
  private readonly last = new Map<Section, string>();
  /** Appended synchronously, so what the entity did is on disk before anything else happens: a resumed session needs all of it. */
  private readonly eventsOut: number;
  private readonly framesOut: number;
  private capturePending = false;
  private finished = false;

  /** A new recording, or (`resume`) one read back from disk that carries on in the same folder. */
  constructor(root: string, config: Record<string, unknown>, private readonly snapshot: () => EntitySnapshot, resume?: SessionRecording) {
    fs.mkdirSync(root, { recursive: true });
    writeSessionsReadme(root);
    if (!resume) pruneSessions(root, KEEP_SESSIONS - 1);
    this.meta = resume
      ? { ...resume.meta, status: 'live', endedAt: undefined, endReason: undefined }
      : { id: newSessionId(), status: 'live', startedAt: new Date().toISOString(), config, events: 0, frames: 0 };
    this.dir = path.join(root, this.meta.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.eventsOut = fs.openSync(path.join(this.dir, 'events.jsonl'), 'a');
    this.framesOut = fs.openSync(path.join(this.dir, 'frames.jsonl'), 'a');
    if (resume) {
      this.events.push(...resume.events);
      this.frames.push(...resume.frames);
      // Frames only carry what changed, so start from the sections as the recording left them.
      for (const frame of resume.frames) for (const [section, value] of Object.entries(frame.patch)) this.last.set(section as Section, JSON.stringify(value));
    }
    this.writeMeta();
    // Frame zero: the full state before the first event.
    if (!resume) this.capture(0);
  }

  /** Where worker conversations are kept, so a resumed session can continue them. */
  get conversationsDir(): string { return path.join(this.dir, 'conversations'); }

  get id(): string { return this.meta.id; }

  record(event: EntityEvent): void {
    if (this.finished) return;
    this.events.push(event);
    fs.writeSync(this.eventsOut, `${JSON.stringify(event)}\n`);
    this.meta.events = this.events.length;
    this.capture(event.seq, PER_EVENT);
    if (!this.meta.firstMessage && event.type === 'chat_message' && event.by === 'user') {
      this.meta.firstMessage = String(event.data.text ?? '').slice(0, 200);
      this.writeMeta();
    }
    // Snapshot once the runtime has finished handling this event (and any it appended in the same turn).
    if (this.capturePending) return;
    this.capturePending = true;
    queueMicrotask(() => {
      this.capturePending = false;
      const last = this.events[this.events.length - 1];
      if (last) this.capture(last.seq);
    });
  }

  /** Ends the recording: `ended` for good (Reset), or `suspended` to be resumed when the Hub starts again. */
  finish(reason: string, status: 'ended' | 'suspended' = 'ended'): void {
    if (this.finished) return;
    const last = this.events[this.events.length - 1];
    if (last && !this.frames.some((f) => f.seq === last.seq)) this.capture(last.seq);
    this.finished = true;
    Object.assign(this.meta, { status, endedAt: new Date().toISOString(), endReason: reason });
    this.writeMeta();
    fs.closeSync(this.eventsOut);
    fs.closeSync(this.framesOut);
  }

  recording(): SessionRecording { return { meta: { ...this.meta }, events: [...this.events], frames: [...this.frames] }; }

  private capture(seq: number, sections: readonly Section[] = SECTIONS): void {
    if (this.finished) return;
    const snapshot = this.snapshot();
    const patch: SnapshotFrame['patch'] = {};
    for (const section of sections) {
      const json = JSON.stringify(snapshot[section]);
      if (this.last.get(section) === json) continue;
      this.last.set(section, json);
      (patch as Record<string, unknown>)[section] = snapshot[section];
    }
    if (!Object.keys(patch).length && this.frames.length) return;
    const frame: SnapshotFrame = { seq, t: snapshot.t, patch };
    this.frames.push(frame);
    fs.writeSync(this.framesOut, `${JSON.stringify(frame)}\n`);
    this.meta.frames = this.frames.length;
  }

  private writeMeta(): void {
    try { fs.writeFileSync(path.join(this.dir, 'meta.json'), `${JSON.stringify(this.meta, null, 2)}\n`); } catch { /* the recording itself continues */ }
  }
}

/** Past and current sessions, newest first. A session left `live` by a Hub that died is `interrupted`. */
export function listSessions(root: string, currentId: string | null): SessionMeta[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(isSessionId).sort().reverse().flatMap((id) => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8')) as SessionMeta;
      if (meta.status === 'live' && id !== currentId) meta.status = 'interrupted';
      return [meta];
    } catch { return []; }
  });
}

export function readSession(root: string, id: string): SessionRecording | null {
  if (!isSessionId(id)) return null;
  const dir = path.join(root, id);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) return null;
  const lines = <T>(file: string): T[] => {
    try {
      return fs.readFileSync(path.join(dir, file), 'utf8').split('\n').flatMap((line) => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line) as T]; } catch { return []; }
      });
    } catch { return []; }
  };
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as SessionMeta;
  if (meta.status === 'live') meta.status = 'interrupted';
  return { meta, events: lines<EntityEvent>('events.jsonl'), frames: lines<SnapshotFrame>('frames.jsonl') };
}

function pruneSessions(root: string, keep: number): void {
  const ids = fs.readdirSync(root).filter(isSessionId).sort();
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) {
    try { fs.rmSync(path.join(root, id), { recursive: true, force: true }); } catch { /* try again next session */ }
  }
}

function writeSessionsReadme(root: string): void {
  try { fs.writeFileSync(path.join(root, 'README.md'), SESSIONS_README); } catch { /* optional */ }
}

const SESSIONS_README = `# Entity sessions

Recordings of entity bench sessions (Drone Hub → Entity window). One folder per session, from
Start until Reset, named \`YYYYMMDD-HHMMSS-xxxx\` (local time). The newest ${KEEP_SESSIONS} are kept.
The bench can replay any of them: Replay in the timeline bar under the bench.

Each folder holds:

- \`meta.json\`: id, status (\`live\`; \`ended\` after Reset; \`suspended\` when the Hub closed while it
  ran; or \`live\` left behind by a Hub that stopped, which the Hub reports as \`interrupted\`; the Hub resumes
  the newest session when it is suspended or interrupted), start and end time, end reason, the bench config (models,
  evaluator, review, workspace), event and frame counts (as of the last update), and the user's first chat message.
- \`events.jsonl\`: the entity's event log, one event per line, in order. This is the source of truth:
  \`{ seq, t, at, type, by, data }\`, where \`t\` is ms since the session started, \`at\` is epoch ms,
  and \`by\` is \`user\`, \`host\`, \`system\` or a limb id (\`head\`, \`voice\`, \`reviewer\`, \`worker-3\`, \`watch-5\` …).
- \`conversations/<worker>.jsonl\`: each worker's conversation with its model, one message per line,
  so a resumed session can continue it.
- \`frames.jsonl\`: snapshots of what the log alone does not give, as \`{ seq, t, patch }\`, where \`patch\`
  holds only the sections that changed (\`status\`, \`world\`, \`levels\`, \`senses\`, \`jev\`). \`world\` and
  \`levels\` are exact after every event; the others are captured once the runtime finishes handling a batch of
  events. Limbs, stops, notes and health are rebuilt from \`events.jsonl\` with \`replayRuntime\` from
  \`@entity/core/state\` (older recordings also carry them as \`limbs\`, \`stops\`, \`self\` and \`health\`). Frame 0 (seq 0) is the full
  state at Start. The snapshot after event N is every patch with \`seq <= N\` applied in order
  (several frames can share a seq).

Useful queries:

\`\`\`sh
cd "$(ls -d */ | tail -1)"                                  # newest session
jq -c 'select(.type=="chat_message") | {t, by, text: .data.text}' events.jsonl
jq -c 'select(.by!="user" and .by!="system") | {t, by, type}' events.jsonl | head -50
jq -c 'select(.type=="run_finished") | {by, ms: .data.ms, aborted: .data.aborted}' events.jsonl
jq -c 'select(.type=="limb_failed" or .type=="output_stopped")' events.jsonl
\`\`\`

Event types and the runtime are documented in entity/docs (core-model.md, architecture.md,
session-logs.md) in the drone repo.
`;
