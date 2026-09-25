import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';

/**
 * The Work view: which worker is on which request, whether it is thinking, and how far it has got.
 * Everything comes from the snapshot and the event log (so it also works while replaying a recording),
 * except the done / doing / next steps, which come from `work_summary` events written by a cheap model.
 */

type WorkerState = 'need' | 'think' | 'act' | 'wait' | 'done' | 'stop';
type Limb = EntitySnapshot['limbs'][number];

export interface WorkItem {
  id: string;
  name: string;
  state: WorkerState;
  label: string;
  since?: number;
  pulse: boolean;
  now?: { verb: string; object?: string; at: number };
  steps?: { done: string[]; doing: string[]; next: string[]; blocker?: string };
  ask?: { text: string; seq: number; routedMs?: number };
  model?: string;
  parent?: string;
  claims: string[];
  durationMs: number;
  cost: number;
  tokens: number;
  result?: string;
  lastActivity: number;
}

const VERBS: Record<string, string> = {
  read_file: 'reading', list_files: 'listing', search: 'searching', write_file: 'writing', edit_file: 'editing', run: 'running',
  say: 'replying', claim: 'claiming', release: 'releasing', share: 'sharing', note: 'noting', finish_task: 'finishing',
  set_watch: 'setting a watch', run_program: 'running a program', press: 'pressing', key_down: 'holding', key_up: 'releasing',
};

const GROUPS: { key: string; label: string; of: WorkerState[] }[] = [
  { key: 'need', label: 'Needs you', of: ['need'] },
  { key: 'think', label: 'Thinking', of: ['think'] },
  { key: 'act', label: 'Working', of: ['act'] },
  { key: 'wait', label: 'Waiting', of: ['wait'] },
  { key: 'fin', label: 'Finished', of: ['done', 'stop'] },
];

const STATE_COLOR: Record<WorkerState, string> = {
  need: 'var(--orange, #e8773a)', think: 'var(--yellow, #d29922)', act: 'var(--accent)', wait: 'var(--muted)', done: 'var(--green, #3fb950)', stop: 'var(--red, #e5534b)',
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
  let lastActivity = l.createdAt;
  for (const e of own) {
    if (e.type === 'run_finished') {
      const usage = e.data.usage as { input?: number; output?: number; cost?: number } | null | undefined;
      cost += usage?.cost ?? 0;
      tokens += (usage?.input ?? 0) + (usage?.output ?? 0);
    }
    if (e.type === 'tool_called') lastCall = e;
    if (e.type === 'tool_done') lastDone = e;
    if (e.type === 'chat_message') lastSaid = e;
    if (e.by === l.id) lastActivity = Math.max(lastActivity, e.t);
  }
  const replyTo = l.replyTo !== undefined ? messages.get(l.replyTo) : undefined;
  const userSpokeAfter = (t: number) => [...messages.values()].some(m => m.t > t);
  const inFlight = lastCall && (!lastDone || lastDone.t < lastCall.t || lastDone.data.run !== lastCall.data.run) ? lastCall : undefined;
  const failedLast = lastDone && lastDone.data.ok === false && (!lastCall || lastCall.t <= lastDone.t) ? lastDone : undefined;
  const nowOf = (e: EntityEvent) => ({ verb: VERBS[String(e.data.name)] ?? String(e.data.name), object: String(e.data.summary ?? '') || undefined, at: e.t });

  let state: WorkerState;
  let label: string;
  let since: number | undefined;
  let pulse = false;
  let now: WorkItem['now'];
  if (l.status === 'done') { state = 'done'; label = 'done'; }
  else if (l.status !== 'running') { state = l.status === 'failed' ? 'need' : 'stop'; label = l.status === 'failed' ? 'failed' : 'stopped'; }
  else if (l.waitFor) { state = 'wait'; label = `after ${l.waitFor}`; }
  else if (inFlight) { const n = nowOf(inFlight); state = 'act'; label = n.verb; since = inFlight.t; now = n; }
  else if (failedLast && /^(refused|output stopped)/.test(String(failedLast.data.note))) {
    state = 'need'; label = 'blocked'; since = failedLast.t;
    now = { verb: 'blocked:', object: String(failedLast.data.note).replace(/^refused: /, '').slice(0, 90), at: failedLast.t };
  } else if (l.runs.length) {
    const start = Math.max(...l.runs.map(r => r.startedAt), lastDone?.t ?? -Infinity);
    state = 'think'; label = 'thinking'; since = start; pulse = true;
    if (lastCall) now = { ...nowOf(lastCall), verb: `last: ${nowOf(lastCall).verb}` };
  } else if (lastSaid && /\?\s*$/.test(String(lastSaid.data.text)) && !userSpokeAfter(lastSaid.t)) {
    state = 'need'; label = 'asking you'; since = lastSaid.t;
    now = { verb: 'asked', object: String(lastSaid.data.text).slice(0, 90), at: lastSaid.t };
  } else { state = 'wait'; label = 'idle'; }

  const s = summary?.data as WorkItem['steps'] | undefined;
  return {
    id: l.id, name: l.name, state, label, since, pulse, now,
    steps: s ? { done: s.done ?? [], doing: s.doing ?? [], next: s.next ?? [], blocker: s.blocker } : undefined,
    ask: replyTo ? { text: String(replyTo.data.text), seq: replyTo.seq, routedMs: spawn ? Math.max(0, spawn.t - replyTo.t) : undefined } : undefined,
    model: l.model?.split('/').pop(),
    parent: spawn?.data.fork_of ? String(spawn.data.fork_of) : undefined,
    claims: l.claims ?? [],
    durationMs: (l.endedAt ?? snapshot.t) - l.createdAt,
    cost, tokens,
    result: l.result,
    lastActivity,
  };
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const ago = (ms: number) => (ms < 1500 ? 'just now' : ms < 60_000 ? `${Math.round(ms / 1000)}s ago` : `${Math.round(ms / 60_000)}m ago`);
const spend = (cost: number, tokens: number) => (cost > 0 ? `$${cost < 10 ? cost.toFixed(2) : cost.toFixed(0)}` : tokens > 0 ? `${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tok` : '—');

export function EntityWork({ snapshot, events, live, onWorker }: {
  snapshot: EntitySnapshot;
  events: EntityEvent[];
  /** False while replaying a recording: actions are hidden. */
  live: boolean;
  onWorker(id: string, action: 'message' | 'stop', text?: string): void;
}) {
  const { workers, head, costTotal, tokensTotal } = React.useMemo(() => deriveWork(snapshot, events), [snapshot, events]);
  const [filter, setFilter] = React.useState<'active' | 'all' | 'need'>('active');
  const [density, setDensity] = React.useState<'rows' | 'cards'>('rows');
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set(['fin']));
  const [query, setQuery] = React.useState('');
  const toggle = (set: Set<string>, key: string) => { const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); return next; };
  const t = snapshot.t;

  const visible = (w: WorkItem) => {
    if (filter === 'active' && (w.state === 'done' || w.state === 'stop')) return false;
    if (filter === 'need' && w.state !== 'need') return false;
    if (!query.trim()) return true;
    const hay = [w.name, w.id, w.ask?.text, w.now?.object, w.result, ...w.claims].join(' ').toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  };

  return (
    <section className="flex min-h-0 flex-col bg-[var(--panel)]" aria-label="Work">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
        <Segmented<'active' | 'all' | 'need'> value={filter} onChange={setFilter} options={[['active', 'Active'], ['all', 'All'], ['need', 'Needs you']]} label="Show" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by name, file or request"
          className="min-w-[120px] max-w-[240px] flex-1 rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 text-[12px] text-[var(--fg)] outline-none" />
        {head ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-[12px]" style={{ color: STATE_COLOR.think }}
            title={`Head is thinking: ${head.reason}`}>
            <Dot pulse /><span className="text-[var(--fg-secondary,var(--fg))]">head</span>
            <span className="max-w-[26ch] truncate text-[var(--muted)]">{head.reason}</span>
            <span className="font-mono text-[11px] text-[var(--muted)]">{clock(t - head.since)}</span>
          </span>
        ) : null}
        <span className="ml-auto flex gap-3 font-mono text-[12px] text-[var(--muted)]">
          <span title="Session time">{clock(t)}</span>
          <span title={costTotal > 0 ? 'Model cost this session' : 'Tokens this session (subscription models report no price)'}>{spend(costTotal, tokensTotal)}</span>
        </span>
        <Segmented<'rows' | 'cards'> value={density} onChange={setDensity} options={[['rows', 'Rows'], ['cards', 'Cards']]} label="Density" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {workers.length === 0 ? (
          <div className="p-4 text-[var(--muted)]">No workers yet. Ask for something that takes real work and a worker starts on it.</div>
        ) : GROUPS.map(group => {
          const items = workers.filter(w => group.of.includes(w.state) && visible(w)).sort((a, b) => b.lastActivity - a.lastActivity);
          if (!items.length) return null;
          const isCollapsed = collapsed.has(group.key);
          const cost = items.reduce((sum, w) => sum + w.cost, 0);
          const tokens = items.reduce((sum, w) => sum + w.tokens, 0);
          const byId = new Set(items.map(w => w.id));
          const roots = items.filter(w => !w.parent || !byId.has(w.parent));
          const ordered = roots.flatMap(r => [{ w: r, depth: 0 }, ...items.filter(c => c.parent === r.id).map(c => ({ w: c, depth: 1 }))]);
          return (
            <section key={group.key} className="border-b border-[var(--border-subtle,var(--border))]">
              <button type="button" aria-expanded={!isCollapsed} onClick={() => setCollapsed(c => toggle(c, group.key))}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] uppercase tracking-[0.06em] text-[var(--muted)] hover:bg-[var(--hover)]">
                <span className="inline-block w-2.5 transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : undefined }}>▾</span>
                {group.label} <span className="tabular-nums">{items.length}</span>
                <span className="ml-auto truncate normal-case tracking-normal text-[12px] opacity-80">
                  {isCollapsed ? `${items.slice(0, 3).map(w => w.name).join(' · ')}${items.length > 3 ? ` +${items.length - 3}` : ''}  ` : ''}{spend(cost, tokens)}
                </span>
              </button>
              {isCollapsed ? null : density === 'cards' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2 px-3 pb-3 pt-1">
                  {items.map(w => <WorkerCard key={w.id} w={w} t={t} live={live} onWorker={onWorker} />)}
                </div>
              ) : ordered.map(({ w, depth }) => (
                <React.Fragment key={w.id}>
                  <WorkerRow w={w} t={t} depth={depth} open={open.has(w.id)} onToggle={() => setOpen(o => toggle(o, w.id))} />
                  {open.has(w.id) ? <WorkerDetail w={w} t={t} live={live} onWorker={onWorker} /> : null}
                </React.Fragment>
              ))}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange(v: T): void; options: [T, string][]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded border border-[var(--border)] p-px text-[12px]">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`rounded-sm px-2 py-px ${value === v ? 'bg-[var(--hover)] text-[var(--fg)]' : 'text-[var(--muted)]'}`}>{text}</button>
      ))}
    </div>
  );
}

function Dot({ pulse }: { pulse?: boolean }) {
  return <span className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-current ${pulse ? 'motion-safe:animate-pulse' : ''}`} />;
}

function Status({ w, t }: { w: WorkItem; t: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: STATE_COLOR[w.state] }}>
      <Dot pulse={w.pulse} />{w.label}{w.since !== undefined && (w.state === 'think' || w.state === 'act') ? <span className="font-mono text-[11px]">{clock(t - w.since)}</span> : null}
    </span>
  );
}

function NowLine({ w, t }: { w: WorkItem; t: number }) {
  if (w.state === 'done' || w.state === 'stop' || w.label === 'failed') return <span className="block truncate text-[var(--muted)]" title={w.result}>{w.result ?? ''}</span>;
  if (!w.now) return <span className="text-[var(--muted)] opacity-70">{w.state === 'wait' ? 'not started' : ''}</span>;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[var(--fg-secondary,var(--fg))]">{w.now.verb}</span>
      {w.now.object ? <span className="truncate rounded bg-[var(--panel-alt)] px-1 font-mono text-[11px]">{w.now.object}</span> : null}
      <span className="shrink-0 text-[11px] text-[var(--muted)] opacity-80">{ago(t - w.now.at)}</span>
    </span>
  );
}

function Pips({ w }: { w: WorkItem }) {
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

function WorkerRow({ w, t, depth, open, onToggle }: { w: WorkItem; t: number; depth: number; open: boolean; onToggle(): void }) {
  // Two lines on fixed columns, so every row lines up: what it is and how it stands on top,
  // what it is doing (or what it produced) right under the name.
  return (
    <div role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      className="grid cursor-pointer grid-cols-[3px_minmax(0,1fr)_112px_72px_48px_56px] grid-rows-[auto_auto] items-center gap-x-3 py-1 pr-3 hover:bg-[var(--hover)]">
      <span className="row-span-2 self-stretch" style={{ background: STATE_COLOR[w.state] }} />
      <span className="min-w-0 truncate font-medium" style={{ paddingLeft: depth * 14 }} title={w.name}>
        {depth ? '↳ ' : ''}{w.name}<span className="ml-1.5 font-mono text-[11px] font-normal text-[var(--muted)] opacity-70">{w.id}</span>
      </span>
      <Status w={w} t={t} />
      <Pips w={w} />
      <span className="text-right font-mono text-[12px] tabular-nums text-[var(--muted)]">{clock(w.durationMs)}</span>
      <span className="text-right font-mono text-[12px] tabular-nums text-[var(--muted)]">{spend(w.cost, w.tokens)}</span>
      <span className="col-span-3 col-start-2 min-w-0 truncate text-[12px]" style={{ paddingLeft: depth * 14 }}><NowLine w={w} t={t} /></span>
    </div>
  );
}

function Steps({ w }: { w: WorkItem }) {
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

function WorkerDetail({ w, t, live, onWorker }: { w: WorkItem; t: number; live: boolean; onWorker(id: string, action: 'message' | 'stop', text?: string): void }) {
  const [text, setText] = React.useState('');
  const running = w.state !== 'done' && w.state !== 'stop';
  return (
    <div className="grid gap-1.5 bg-[var(--hover)] py-2 pl-[15px] pr-3" style={{ borderLeft: `3px solid ${STATE_COLOR[w.state]}` }}>
      {w.ask ? (
        <div className="truncate text-[var(--muted)]">
          <span className="text-[var(--fg-secondary,var(--fg))]">“{w.ask.text}”</span> · #{w.ask.seq}
          {w.ask.routedMs !== undefined ? ` · routed in ${(w.ask.routedMs / 1000).toFixed(1)}s` : ''}{w.model ? ` · ${w.model}` : ''}{w.parent ? ` · forked from ${w.parent}` : ''}
        </div>
      ) : null}
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
      <span className="sr-only">{clock(t)}</span>
    </div>
  );
}

function WorkerCard({ w, t, live, onWorker }: { w: WorkItem; t: number; live: boolean; onWorker(id: string, action: 'message' | 'stop', text?: string): void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <article className="relative grid gap-1.5 rounded-lg border border-[var(--border)] py-2 pl-3 pr-2.5">
      <span className="absolute -left-px bottom-2.5 top-2.5 w-[3px] rounded-r" style={{ background: STATE_COLOR[w.state] }} />
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" className="truncate text-left font-semibold" onClick={() => setOpen(o => !o)} aria-expanded={open}>{w.name}</button>
        <Status w={w} t={t} />
        <span className="ml-auto flex gap-2 whitespace-nowrap font-mono text-[12px] text-[var(--muted)]"><span>{clock(w.durationMs)}</span><span>{spend(w.cost, w.tokens)}</span></span>
      </div>
      {w.ask ? <div className="truncate text-[var(--muted)]">“{w.ask.text}”</div> : null}
      <div className="min-w-0"><NowLine w={w} t={t} /></div>
      {open ? <WorkerDetail w={w} t={t} live={live} onWorker={onWorker} /> : <Pips w={w} />}
    </article>
  );
}
