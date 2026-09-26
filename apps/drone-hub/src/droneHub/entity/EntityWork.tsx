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
  /** The worker it was dispatched to wait for; unlike waitFor, kept once the wait is over. */
  after?: string;
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
export function deriveWork(snapshot: EntitySnapshot, events: EntityEvent[]): { workers: WorkItem[]; head?: { reason: string; since: number }; costTotal: number; tokensTotal: number; usageDetail: string } {
  const byLimb = new Map<string, EntityEvent[]>();
  const push = (id: string, e: EntityEvent) => { const list = byLimb.get(id); if (list) list.push(e); else byLimb.set(id, [e]); };
  const messages = new Map<number, EntityEvent>();
  const spawned = new Map<string, EntityEvent>();
  const summaries = new Map<string, EntityEvent>();
  for (const e of events) {
    if (e.type === 'chat_message') messages.set(e.seq, e);
    if (e.type === 'limb_spawned') spawned.set(String(e.data.id), e);
    if (e.type === 'work_summary') summaries.set(String(e.data.limb), e);
    push(e.by, e);
    if (e.type === 'steered' || e.type === 'limb_revived') push(String(e.data.id), e);
  }

  const workers = snapshot.limbs.filter(l => l.role === 'task').map((l): WorkItem => deriveWorker(l, snapshot, byLimb.get(l.id) ?? [], messages, summaries.get(l.id)));
  const head = snapshot.limbs.find(l => l.id === 'head');
  const headRun = head?.runs.slice().sort((a, b) => b.startedAt - a.startedAt)[0];
  const usage = snapshot.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 };
  return { workers, head: headRun ? { reason: headRun.reason, since: headRun.startedAt } : undefined, costTotal: usage.cost, tokensTotal: tokens(usage), usageDetail: usageDetail(snapshot) };
}

function deriveWorker(l: Limb, snapshot: EntitySnapshot, own: EntityEvent[], messages: Map<number, EntityEvent>, summary: EntityEvent | undefined): WorkItem {
  let lastCall: EntityEvent | undefined;
  let lastDone: EntityEvent | undefined;
  for (const e of own) {
    if (e.type === 'tool_called') lastCall = e;
    if (e.type === 'tool_done') lastDone = e;
  }
  const question = l.asking !== undefined ? messages.get(l.asking) : undefined;
  // A call is in flight only while its run is: an aborted run (Pause, kill) leaves a call without tool_done.
  const inFlight = lastCall && l.runs.some(r => r.id === lastCall!.data.run) && (!lastDone || lastDone.t < lastCall.t || lastDone.data.run !== lastCall.data.run) ? lastCall : undefined;
  const nowOf = (e: EntityEvent) => ({ verb: VERBS[String(e.data.name)] ?? String(e.data.name), object: String(e.data.summary ?? '') || undefined, at: e.t });

  let state: WorkerState;
  let label: string;
  let now: WorkItem['now'];
  if (l.status === 'done') { state = 'done'; label = 'done'; }
  else if (l.status === 'queued') { state = 'wait'; label = 'queued'; }
  else if (l.status === 'waiting') { state = 'wait'; label = l.waitFor ? `after ${nameOf(snapshot, l.waitFor)}` : 'waiting'; }
  else if (l.status !== 'running') { state = l.status === 'failed' ? 'need' : 'stop'; label = l.status === 'failed' ? 'failed' : 'stopped'; }
  else if (inFlight) { const n = nowOf(inFlight); state = 'act'; label = n.verb; now = n; }
  else if (l.blockedBy) {
    state = 'need'; label = 'blocked';
    now = { verb: 'blocked:', object: `"${l.blockedBy.path}" is held by ${nameOf(snapshot, l.blockedBy.limb)}`, at: lastDone?.t ?? l.createdAt };
  } else if (l.runs.length) {
    const start = Math.max(...l.runs.map(r => r.startedAt), lastDone?.t ?? -Infinity);
    state = 'think'; label = 'thinking';
    if (lastCall) now = { ...nowOf(lastCall), verb: `last: ${nowOf(lastCall).verb}` };
  } else if (l.asking !== undefined) {
    // It asked something it needs answered and waits for it.
    state = 'need'; label = 'asking you';
    now = { verb: 'asked', object: String(question?.data.text ?? '').slice(0, 90), at: question?.t ?? l.createdAt };
  } else { state = 'wait'; label = 'idle'; }

  const s = summary?.data as WorkItem['steps'] | undefined;
  return {
    id: l.id, name: l.name, state, label, now,
    steps: s ? { done: s.done ?? [], doing: s.doing ?? [], next: s.next ?? [], blocker: s.blocker } : undefined,
    model: l.model?.split('/').pop(),
    parent: l.forkOf,
    claims: l.claims ?? [],
    durationMs: (l.endedAt ?? snapshot.t) - l.createdAt,
    cost: l.usage?.cost ?? 0, tokens: l.usage ? tokens(l.usage) : 0,
    result: l.result,
    status: l.status, blockedBy: l.blockedBy?.limb, task: l.task, createdAt: l.createdAt, endedAt: l.endedAt, replyTo: l.replyTo, group: l.group, waitFor: l.waitFor, after: l.after,
  };
}

type Usage = EntitySnapshot['usage'];
/** Every token a call carried, cached ones included: the context it really used. */
const tokens = (u: Pick<Usage, 'input' | 'output'> & Partial<Usage>) => u.input + u.output + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
const count = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Hover text for the session's spend: tokens by kind, what summaries and senses took, and calls with no known price. */
function usageDetail(snapshot: EntitySnapshot): string {
  const u = snapshot.usage;
  if (!u) return 'Model cost this session';
  const lines = [
    `Model cost this session, at list prices (subscription models too): $${u.cost.toFixed(4)}`,
    `Input ${count(u.input)} · cache read ${count(u.cacheRead)} · cache write ${count(u.cacheWrite)} · output ${count(u.output)}`,
  ];
  const by = snapshot.usageBy;
  if (by?.summaries && tokens(by.summaries)) lines.push(`Work summaries: $${by.summaries.cost.toFixed(4)}`);
  if (by?.senses && tokens(by.senses)) lines.push(`Senses (Jev): $${by.senses.cost.toFixed(4)}`);
  if (u.unpriced) lines.push(`${u.unpriced} call${u.unpriced === 1 ? '' : 's'} with no known price, not included`);
  return lines.join('\n');
}

/** A worker's name for user-facing text; ids are for the runtime. */
const nameOf = (snapshot: EntitySnapshot, id: string) => snapshot.limbs.find(l => l.id === id)?.name ?? id;

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
