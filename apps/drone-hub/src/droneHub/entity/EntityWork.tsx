import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';

const EntityWorkCanvas = React.lazy(() => import('./EntityWorkCanvas').then(m => ({ default: m.EntityWorkCanvas })));

/**
 * The Work view: which worker is on which request, whether it is thinking, and how far it has got.
 * Everything comes from the snapshot and the event log (so it also works while replaying a recording),
 * except the done / doing / next steps, which come from `work_summary` events written by a cheap model.
 */

export type WorkerState = 'need' | 'think' | 'act' | 'wait' | 'done' | 'stop';
type Limb = EntitySnapshot['limbs'][number];

export interface WorkItem {
  id: string;
  name: string;
  state: WorkerState;
  label: string;
  now?: { verb: string; object?: string; at: number };
  steps?: { done: string[]; doing: string[]; next: string[]; blocker?: string };
  model?: string;
  parent?: string;
  claims: string[];
  durationMs: number;
  cost: number;
  tokens: number;
  result?: string;
  status: string;
  /** What the worker was asked to do. */
  task?: string;
  createdAt: number;
  endedAt?: number;
  replyTo?: number;
  group?: string;
  waitFor?: string;
  /** The worker holding a file this one needs, when blocked. */
  blockedBy?: string;
}

const VERBS: Record<string, string> = {
  read_file: 'reading', list_files: 'listing', search: 'searching', write_file: 'writing', edit_file: 'editing', run: 'running',
  say: 'replying', claim: 'claiming', release: 'releasing', share: 'sharing', note: 'noting', finish_task: 'finishing',
  set_watch: 'setting a watch', run_program: 'running a program', press: 'pressing', key_down: 'holding', key_up: 'releasing',
};

export const STATE_COLOR: Record<WorkerState, string> = {
  need: 'var(--orange, #e8773a)', think: 'var(--yellow, #d29922)', act: 'var(--act, var(--accent))', wait: 'var(--muted)', done: 'var(--green, #3fb950)', stop: 'var(--red, #e5534b)',
};

/** Derives the Work view from a snapshot and the event log. Pure, so it is cheap to rerun on every event. */
export function deriveWork(snapshot: EntitySnapshot, events: EntityEvent[]): { workers: WorkItem[]; head?: { reason: string; since: number }; costTotal: number; tokensTotal: number } {
  const byLimb = new Map<string, EntityEvent[]>();
  const push = (id: string, e: EntityEvent) => { const list = byLimb.get(id); if (list) list.push(e); else byLimb.set(id, [e]); };
  const messages = new Map<number, EntityEvent>();
  const spawned = new Map<string, EntityEvent>();
  const summaries = new Map<string, EntityEvent>();
  let costTotal = 0;
  let tokensTotal = 0;
  for (const e of events) {
    if (e.type === 'chat_message' && e.by === 'user') messages.set(e.seq, e);
    if (e.type === 'limb_spawned') spawned.set(String(e.data.id), e);
    if (e.type === 'work_summary') summaries.set(String(e.data.limb), e);
    if (e.type === 'run_finished') {
      const usage = e.data.usage as { input?: number; output?: number; cost?: number } | null | undefined;
      costTotal += usage?.cost ?? 0;
      tokensTotal += (usage?.input ?? 0) + (usage?.output ?? 0);
    }
    push(e.by, e);
    if (e.type === 'steered' || e.type === 'limb_revived') push(String(e.data.id), e);
  }

  const workers = snapshot.limbs.filter(l => l.role === 'task').map((l): WorkItem => deriveWorker(l, snapshot, byLimb.get(l.id) ?? [], messages, spawned.get(l.id), summaries.get(l.id)));
  const head = snapshot.limbs.find(l => l.id === 'head');
  const headRun = head?.runs.slice().sort((a, b) => b.startedAt - a.startedAt)[0];
  return { workers, head: headRun ? { reason: headRun.reason, since: headRun.startedAt } : undefined, costTotal, tokensTotal };
}

function deriveWorker(l: Limb, snapshot: EntitySnapshot, own: EntityEvent[], messages: Map<number, EntityEvent>, spawn: EntityEvent | undefined, summary: EntityEvent | undefined): WorkItem {
  let cost = 0;
  let tokens = 0;
  let lastCall: EntityEvent | undefined;
  let lastDone: EntityEvent | undefined;
  let lastSaid: EntityEvent | undefined;
  for (const e of own) {
    if (e.type === 'run_finished') {
      const usage = e.data.usage as { input?: number; output?: number; cost?: number } | null | undefined;
      cost += usage?.cost ?? 0;
      tokens += (usage?.input ?? 0) + (usage?.output ?? 0);
    }
    if (e.type === 'tool_called') lastCall = e;
    if (e.type === 'tool_done') lastDone = e;
    if (e.type === 'chat_message') lastSaid = e;
  }
  const replyTo = l.replyTo !== undefined ? messages.get(l.replyTo) : undefined;
  const userSpokeAfter = (t: number) => [...messages.values()].some(m => m.t > t);
  // A call is in flight only while its run is: an aborted run (Pause, kill) leaves a call without tool_done.
  const inFlight = lastCall && l.runs.some(r => r.id === lastCall!.data.run) && (!lastDone || lastDone.t < lastCall.t || lastDone.data.run !== lastCall.data.run) ? lastCall : undefined;
  const failedLast = lastDone && lastDone.data.ok === false && (!lastCall || lastCall.t <= lastDone.t) ? lastDone : undefined;
  const nowOf = (e: EntityEvent) => ({ verb: VERBS[String(e.data.name)] ?? String(e.data.name), object: String(e.data.summary ?? '') || undefined, at: e.t });

  let state: WorkerState;
  let label: string;
  let now: WorkItem['now'];
  let blockedBy: string | undefined;
  if (l.status === 'done') { state = 'done'; label = 'done'; }
  else if (l.status === 'queued') { state = 'wait'; label = 'queued'; }
  else if (l.status === 'waiting') { state = 'wait'; label = l.waitFor ? `after ${nameOf(snapshot, l.waitFor)}` : 'waiting'; }
  else if (l.status !== 'running') { state = l.status === 'failed' ? 'need' : 'stop'; label = l.status === 'failed' ? 'failed' : 'stopped'; }
  else if (inFlight) { const n = nowOf(inFlight); state = 'act'; label = n.verb; now = n; }
  else if (failedLast && /^(refused|output stopped)/.test(String(failedLast.data.note))) {
    state = 'need'; label = 'blocked';
    blockedBy = /claimed by (\S+?)[\s(]/.exec(String(failedLast.data.note))?.[1];
    now = { verb: 'blocked:', object: withNames(snapshot, String(failedLast.data.note).replace(/^refused: /, '').replace(/ since [\d.]+s ago$/, '')).slice(0, 120), at: failedLast.t };
  } else if (l.runs.length) {
    const start = Math.max(...l.runs.map(r => r.startedAt), lastDone?.t ?? -Infinity);
    state = 'think'; label = 'thinking';
    if (lastCall) now = { ...nowOf(lastCall), verb: `last: ${nowOf(lastCall).verb}` };
  } else if (lastSaid && /\?\s*$/.test(String(lastSaid.data.text)) && !userSpokeAfter(lastSaid.t)) {
    state = 'need'; label = 'asking you';
    now = { verb: 'asked', object: String(lastSaid.data.text).slice(0, 90), at: lastSaid.t };
  } else { state = 'wait'; label = 'idle'; }

  const s = summary?.data as WorkItem['steps'] | undefined;
  return {
    id: l.id, name: l.name, state, label, now,
    steps: s ? { done: s.done ?? [], doing: s.doing ?? [], next: s.next ?? [], blocker: s.blocker } : undefined,
    model: l.model?.split('/').pop(),
    parent: spawn?.data.fork_of ? String(spawn.data.fork_of) : undefined,
    claims: l.claims ?? [],
    durationMs: (l.endedAt ?? snapshot.t) - l.createdAt,
    cost, tokens,
    result: l.result,
    status: l.status, blockedBy, task: l.task, createdAt: l.createdAt, endedAt: l.endedAt, replyTo: l.replyTo, group: l.group, waitFor: l.waitFor,
  };
}

/** A worker's name for user-facing text; ids are for the runtime. */
const nameOf = (snapshot: EntitySnapshot, id: string) => snapshot.limbs.find(l => l.id === id)?.name ?? id;
/** Replaces worker ids in runtime text (like "claimed by worker-3") with their names. */
const withNames = (snapshot: EntitySnapshot, text: string) => text.replace(/\b(?:worker|task)-\d+\b/g, id => nameOf(snapshot, id));

export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const spend = (cost: number, tokens: number) => (cost > 0 ? `$${cost < 10 ? cost.toFixed(2) : cost.toFixed(0)}` : tokens > 0 ? `${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tok` : '—');

/** The Work tab: the canvas, loaded on demand (it brings in the graph library). */
export function EntityWork(props: React.ComponentProps<typeof EntityWorkCanvas>) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--panel)]" aria-label="Work">
      <React.Suspense fallback={<div className="p-4 text-[var(--muted)]">Loading the canvas…</div>}>
        <div className="entity-work-canvas flex min-h-0 flex-1 flex-col"><EntityWorkCanvas {...props} /></div>
      </React.Suspense>
    </section>
  );
}

export function Dot({ pulse }: { pulse?: boolean }) {
  return <span className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-current ${pulse ? 'motion-safe:animate-pulse' : ''}`} />;
}

export function Pips({ w }: { w: WorkItem }) {
  if (!w.steps) return <span />;
  const color = STATE_COLOR[w.state];
  return (
    <span className="inline-flex gap-[3px]" aria-label={`${w.steps.done.length} done, ${w.steps.doing.length} in progress, ${w.steps.next.length} next`}>
      {w.steps.done.map((_, i) => <span key={`d${i}`} className="h-1.5 w-1.5 rounded-full" style={{ background: STATE_COLOR.done }} />)}
      {w.steps.doing.map((_, i) => <span key={`o${i}`} className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />)}
      {w.steps.next.map((_, i) => <span key={`x${i}`} className="h-1.5 w-1.5 rounded-full border border-[var(--muted)] opacity-60" />)}
    </span>
  );
}

export function Steps({ w }: { w: WorkItem }) {
  if (!w.steps) return <div className="text-[12px] text-[var(--muted)] opacity-80">No summary yet.</div>;
  const item = (glyph: string, color: string, text: string, key: string, dim?: boolean) => (
    <li key={key} className={`grid grid-cols-[14px_1fr] gap-1.5 ${dim ? 'text-[var(--muted)]' : 'text-[var(--fg-secondary,var(--fg))]'}`}>
      <span className="text-center text-[11px] leading-[19px]" style={{ color }}>{glyph}</span><span>{text}</span>
    </li>
  );
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {w.steps.done.map((s, i) => item('✓', STATE_COLOR.done, s, `d${i}`))}
      {w.steps.doing.map((s, i) => item('●', STATE_COLOR[w.state], s, `o${i}`))}
      {w.steps.next.map((s, i) => item('○', 'var(--muted)', s, `x${i}`, true))}
      {w.steps.blocker ? item('!', STATE_COLOR.need, w.steps.blocker, 'b') : null}
    </ul>
  );
}

export function WorkerDetail({ w, live, onWorker }: { w: WorkItem; live: boolean; onWorker(id: string, action: 'message' | 'stop', text?: string): void }) {
  const [text, setText] = React.useState('');
  const running = w.state !== 'done' && w.state !== 'stop';
  return (
    <div className="grid gap-1.5 bg-[var(--hover)] py-2 pl-[15px] pr-3" style={{ borderLeft: `3px solid ${STATE_COLOR[w.state]}` }}>
      <Steps w={w} />
      {w.claims.length ? <div className="flex flex-wrap gap-1">{w.claims.map(c => <span key={c} className="rounded bg-[var(--panel-alt)] px-1 font-mono text-[11px]">{c}</span>)}</div> : null}
      {live && running ? (
        <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); if (text.trim()) { onWorker(w.id, 'message', text.trim()); setText(''); } }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder={`Message ${w.name} directly`}
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 text-[12px] text-[var(--fg)] outline-none" />
          <button type="submit" className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px]">Send</button>
          <button type="button" onClick={() => onWorker(w.id, 'stop')} className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[12px]" style={{ color: STATE_COLOR.stop }}>Stop</button>
        </form>
      ) : null}
      {!running && w.result ? <div className="text-[var(--muted)]">{w.result}</div> : null}
    </div>
  );
}
