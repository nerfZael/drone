import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { clock, deriveWork, spend, spendTitle, STATE_COLOR, type WorkItem } from './EntityWork';
import { WorkerDrawer, type OnWorker } from './EntityWorkCanvas';
import { LimbPanel } from './EntityLimbPanel';
import { deriveTree, type WorkRequest } from './work-tree-model';

type Ask = NonNullable<EntitySnapshot['asks']>[number];
type Zoom = 'labels' | 'gists';

/**
 * The Work tab: one entry per thing you asked for (or the entity started itself), outcome first once it is done, its
 * agents in stages with arrows for what waits on what. Nothing moves on its own. See entity/docs/work-canvas.md.
 */
export function EntityWorkTree({ snapshot, events, live, onWorker, open, onOpenFile }: {
  snapshot: EntitySnapshot; events: EntityEvent[]; live: boolean; onWorker: OnWorker;
  /** A request from the chat to open an agent; `n` changes with every request. */
  open?: { id: string; n: number } | null;
  onOpenFile?(path: string): void;
}) {
  const t = useClock(snapshot, live);
  const work = React.useMemo(() => deriveWork({ ...snapshot, t }, events), [snapshot, events, t]);
  const tree = React.useMemo(() => deriveTree({ ...snapshot, t }, events, work.workers), [snapshot, events, work, t]);
  const [zoom, setZoom] = useZoom();
  const [zooms, setZooms] = React.useState<Record<string, Zoom>>({});
  const [shown, setShown] = React.useState<ReadonlySet<string>>(() => new Set());
  const [cards, setCards] = React.useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = React.useState<{ kind: 'agent' | 'request'; id: string } | null>(null);
  const list = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => { if (open) setSelected({ kind: 'agent', id: open.id }); }, [open]);

  const names = React.useMemo(() => new Map(snapshot.limbs.map(l => [l.id, l.name])), [snapshot.limbs]);
  const ctx: Ctx = {
    t, ran: tree.ran, paused: snapshot.status === 'paused', names, cards, selected: selected?.kind === 'agent' ? selected.id : null,
    toggleCard: id => setCards(prev => toggled(prev, id)),
    select: id => setSelected({ kind: 'agent', id }),
  };
  const agent = selected?.kind === 'agent' ? work.workers.find(w => w.id === selected.id) : undefined;
  const request = selected?.kind === 'request' ? tree.requests.find(r => r.key === selected.id) : undefined;
  const jump = (key: string) => { setSelected({ kind: 'request', id: key }); list.current?.querySelector(`[data-request="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'start' }); };

  return (
    <CtxContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 bg-[var(--bg)]">
      <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label="Work">
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-1.5 text-[12px] text-[var(--muted)]">
          <Segment value={zoom} onChange={z => { setZoom(z); setZooms({}); }} label="Detail on every card" />
          <span className="ml-auto font-mono" title={work.usageDetail}>{clock(tree.ran(0, t))} · {spend(work.costTotal, work.tokensTotal)}</span>
        </div>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
          {tree.running.length ? (
            <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2"><div className="max-w-[1000px]">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{snapshot.status === 'paused' ? 'Paused' : 'Running now'}</div>
              {tree.running.map(r => <RunningLine key={r.key} r={r} onJump={() => jump(r.key)} />)}
            </div></div>
          ) : null}
          <div className="flex max-w-[1000px] flex-col gap-8 px-4 py-4">
            {tree.requests.length === 0 ? <p className="text-[var(--muted)]">No work yet. Ask for something that takes real work and it shows up here.</p> : null}
            {tree.requests.map(r => (
              <RequestView key={r.key} r={r} zoom={zooms[r.key] ?? zoom} onZoom={z => setZooms(prev => ({ ...prev, [r.key]: z }))}
                showWork={shown.has(r.key)} onShowWork={() => setShown(prev => toggled(prev, r.key))}
                selected={selected?.kind === 'request' && selected.id === r.key} onSelect={() => setSelected({ kind: 'request', id: r.key })} />
            ))}
            {tree.untaken.length ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]" title="Things to do you asked for that no agent took and nobody answered.">Asked, not started</div>
                {tree.untaken.map(a => <div key={a.id} className="flex gap-2 py-0.5"><span style={{ color: STATE_COLOR.need }}>○</span><span>{a.text}</span></div>)}
              </div>
            ) : null}
          </div>
        </div>
      </section>
      {agent || request ? (
        // Its own column, so the work beside it stays in full view.
        <div className="relative w-[440px] max-w-[45%] shrink-0 border-l border-[var(--border)] bg-[var(--panel)]">
          {agent ? <WorkerDrawer w={agent} events={events} snapshot={snapshot} t={t} live={live} onWorker={onWorker} onOpenFile={onOpenFile} onClose={() => setSelected(null)} /> : null}
          {request ? <RequestPanel r={request} names={names} onAgent={id => setSelected({ kind: 'agent', id })} onClose={() => setSelected(null)} /> : null}
        </div>
      ) : null}
      </div>
    </CtxContext.Provider>
  );
}

interface Ctx {
  t: number;
  ran(from: number, to: number): number;
  paused: boolean;
  names: Map<string, string>;
  cards: ReadonlySet<string>;
  selected: string | null;
  toggleCard(id: string): void;
  select(id: string): void;
}
const CtxContext = React.createContext<Ctx | null>(null);
const useCtx = () => React.useContext(CtxContext)!;

function RunningLine({ r, onJump }: { r: WorkRequest; onJump(): void }) {
  const { t, ran, paused } = useCtx();
  const done = r.workers.filter(w => w.status === 'done').length;
  const one = r.workers.length === 1 ? r.workers[0] : undefined;
  const info = one ? lineOf(one) : `${done} of ${r.workers.length} agents done`;
  return (
    <button type="button" onClick={onJump} className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--hover)]">
      <StateDot state={paused ? 'paused' : 'running'} />
      <b className="font-medium">{r.title}</b>
      <span className="truncate text-[var(--muted)]">{info}</span>
      <span className="font-mono text-[11px] text-[var(--muted)]">{clock(ran(r.t, t))}</span>
    </button>
  );
}

function RequestView({ r, zoom, onZoom, showWork, onShowWork, selected, onSelect }: {
  r: WorkRequest; zoom: Zoom; onZoom(z: Zoom): void; showWork: boolean; onShowWork(): void; selected: boolean; onSelect(): void;
}) {
  const { t, ran, paused } = useCtx();
  const running = r.status === 'running';
  const doneCount = r.workers.filter(w => w.status === 'done').length;
  const one = r.workers.length === 1 ? r.workers[0] : undefined;
  const sub = r.self ? `Started by the entity${r.why ? ` · ${r.why}` : ''}`
    : running && one ? lineOf(one)
    : running ? `${doneCount} of ${r.workers.length} agents done`
      : r.workers.length > 1 ? `${r.workers.length} agents` : '1 agent';
  const folded = !running && !showWork;
  return (
    <section data-request={r.key} className="scroll-mt-24">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSelect}
          className={`grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 rounded px-2 py-1 text-left hover:bg-[var(--hover)] ${selected ? 'bg-[var(--panel-alt)]' : ''}`}>
          <span className="font-mono text-[12px] text-[var(--muted)]" title={r.at ? new Date(r.at).toLocaleString() : undefined}>{r.at ? timeOfDay(r.at) : ''}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-semibold">
            {r.title}
            {running ? <span className="rounded-full px-2 text-[11px] font-medium" style={{ color: paused ? 'var(--muted)' : WORKING, background: 'color-mix(in srgb, currentColor 14%, transparent)' }}>{paused ? 'paused' : 'working'}</span> : null}
            {r.status === 'stopped' ? <span className="text-[11px] font-normal" style={{ color: STATE_COLOR.stop }}>stopped</span> : null}
          </span>
          <span className="font-mono text-[12px] text-[var(--muted)]">{clock(ran(r.t, r.ended ?? t))}{r.cost || r.tokens ? ` · ${spend(r.cost, r.tokens)}` : ''}</span>
          <span className="col-start-2 text-[12px] text-[var(--muted)]">{sub}</span>
        </button>
        {!folded ? <Segment value={zoom} onChange={onZoom} label={`Detail for ${r.title}`} small /> : null}
      </div>
      {r.asks.length ? <AskLine asks={r.asks} /> : null}
      <div className="ml-6 mt-2 max-w-[960px]">
        {folded ? (
          <>
            {r.outcome ? <AgentCard w={r.outcome} zoom="gists" outcome lead={3} /> : <ParallelOutcome r={r} />}
            {r.workers.length > 1 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
                <span>From</span>
                {r.workers.filter(w => w.id !== r.outcome?.id).map(w => <AgentCard key={w.id} w={w} zoom="labels" />)}
                <button type="button" onClick={onShowWork} className="ml-1 text-[var(--muted)] underline-offset-2 hover:text-[var(--fg)] hover:underline">Show the work</button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {one && zoom === 'labels' ? null : <Stages r={r} zoom={zoom} />}
            {!running ? <button type="button" onClick={onShowWork} className="mt-2 text-[12px] text-[var(--muted)] underline-offset-2 hover:text-[var(--fg)] hover:underline">Hide the work</button> : null}
          </>
        )}
      </div>
    </section>
  );
}

/** What you asked in this request's message, each with where it stands. */
function AskLine({ asks }: { asks: Ask[] }) {
  return (
    <div className="ml-[4.25rem] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
      {asks.filter(a => a.status !== 'replaced').map(a => {
        const again = a.status === 'open' && !!a.resolved;
        const state = a.kind === 'rule' ? 'rule' : again ? 'asked again' : a.status === 'resolved' ? (a.kind === 'question' ? 'answered' : 'done') : 'open';
        const color = state === 'done' || state === 'answered' ? STATE_COLOR.done : again ? STATE_COLOR.need : 'var(--muted)';
        return (
          <span key={a.id} title={[a.resolved?.note, again ? `Asked again after it was resolved by ${a.resolved?.by}` : ''].filter(Boolean).join('\n') || undefined}>
            <span style={{ color }}>{state === 'done' || state === 'answered' ? '✓' : '○'}</span> <span className="text-[var(--fg)]">{a.text}</span> <span style={{ color }}>{state}</span>
          </span>
        );
      })}
    </div>
  );
}

/** A finished request with agents side by side and no one result: each agent's own result, one line each. */
function ParallelOutcome({ r }: { r: WorkRequest }) {
  const { select } = useCtx();
  return (
    <ul className="flex max-w-[640px] flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
      {r.workers.map(w => (
        <li key={w.id}>
          <button type="button" onClick={() => select(w.id)} className="text-left hover:underline">
            <b className="font-medium">{w.name}</b> <span className="text-[var(--muted)]">{w.result ?? w.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Agents in stages, each below what it waits for, with arrows drawn between the measured cards. */
function Stages({ r, zoom }: { r: WorkRequest; zoom: Zoom }) {
  const box = React.useRef<HTMLDivElement | null>(null);
  const [paths, setPaths] = React.useState<{ d: string; released: boolean }[]>([]);
  const byId = new Map(r.workers.map(w => [w.id, w]));
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const rect = (id: string) => el.querySelector(`[data-agent="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      const next: { d: string; released: boolean }[] = [];
      const arrow = (x1: number, y1: number, x2: number, y2: number) => {
        const m = (y1 + y2) / 2;
        return `M${x1} ${y1} C${x1} ${m} ${x2} ${m} ${x2} ${y2 - 7} M${x2 - 5} ${y2 - 8} L${x2} ${y2 - 1} L${x2 + 5} ${y2 - 8}`;
      };
      for (const w of r.workers) {
        const deps = (r.deps[w.id] ?? []).filter(d => byId.has(d));
        const b = rect(w.id);
        if (!deps.length || !b) continue;
        const froms = deps.map(rect).filter((x): x is DOMRect => !!x);
        const x2 = (b.left + b.right) / 2 - base.left, y2 = b.top - base.top;
        const row = r.stages.find(s => deps.every(d => s.includes(d)));
        if (deps.length >= 3 && row && row.length === deps.length) {
          // Waiting on a whole stage: one bracket under it, then one arrow.
          const y = Math.max(...froms.map(a => a.bottom)) - base.top + 10;
          const xs = froms.map(a => (a.left + a.right) / 2 - base.left);
          const left = Math.min(...xs), right = Math.max(...xs);
          const stubs = froms.map(a => `M${(a.left + a.right) / 2 - base.left} ${a.bottom - base.top} V${y}`).join(' ');
          next.push({ d: `${stubs} M${left} ${y} H${right} ${arrow(Math.min(Math.max(x2, left), right), y, x2, y2)}`, released: deps.every(d => byId.get(d)!.status === 'done') });
        } else {
          for (const d of deps) {
            const a = rect(d);
            if (a) next.push({ d: arrow((a.left + a.right) / 2 - base.left, a.bottom - base.top, x2, y2), released: byId.get(d)!.status === 'done' });
          }
        }
      }
      setPaths(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  });
  return (
    <div ref={box} className="relative">
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {paths.map((p, i) => <path key={i} d={p.d} fill="none" strokeWidth={1.5} stroke={p.released ? STATE_COLOR.done : 'var(--muted)'} strokeDasharray={p.released ? undefined : '4 4'} />)}
      </svg>
      {/* Rows line up under the heading; only work that waits on other work is centred, so its arrows read top-down. */}
      <div className="flex flex-col gap-10">
        {r.stages.map((row, i) => (
          <div key={i} className={`flex flex-wrap gap-2 ${r.stages.length > 1 ? 'justify-center' : ''}`}>{row.map(id => byId.get(id)).filter((w): w is WorkItem => !!w).map(w => <AgentCard key={w.id} w={w} zoom={zoom} waits={waitText(r, w.id)} />)}</div>
        ))}
      </div>
    </div>
  );
}

/** One agent. Its time sits in the corner; model, start and cost are on hover; ▸ opens its points in place. */
function AgentCard({ w, zoom, outcome, lead = 0, waits }: { w: WorkItem; zoom: Zoom; outcome?: boolean; lead?: number; waits?: string }) {
  const { t, ran, paused, cards, selected, toggleCard, select } = useCtx();
  const done = w.status === 'done';
  const running = !['done', 'failed', 'cancelled', 'killed'].includes(w.status);
  const time = clock(ran(w.createdAt, w.endedAt ?? t));
  const tip = [`${w.id} · ${w.model ?? ''}`, `${running ? 'running' : 'ran'} ${time}`, spendTitle(w.cost, w.tokens, w.unpriced) + `: ${spend(w.cost, w.tokens)}`, w.why ? `why: ${w.why}` : ''].filter(Boolean).join('\n');
  const head = (
    <span className="flex min-w-0 items-center gap-2">
      <StateDot state={dotState(w, paused)} />
      <span className="truncate font-medium">{w.name}</span>
      {zoom === 'gists' ? <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--muted)]">{time}</span> : null}
    </span>
  );
  const base = `rounded-lg border text-left ${selected === w.id ? 'border-[var(--muted)] bg-[var(--panel-alt)]' : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--faint)]'}`;
  if (zoom === 'labels') {
    return <button type="button" data-agent={w.id} title={`${lineOf(w)}\n\n${tip}`} onClick={() => select(w.id)} className={`${base} rounded-full px-2.5 py-0.5 text-[12px]`}>{head}</button>;
  }
  const open = cards.has(w.id);
  const points = w.points ?? [];
  const shown = done ? (open ? points : points.slice(0, lead)) : [];
  const rest = points.length - lead;
  return (
    <div data-agent={w.id} title={tip} className={`${base} flex flex-col gap-1 px-3 py-2 ${outcome ? 'w-full max-w-[600px]' : 'w-[230px]'}`}>
      <button type="button" onClick={() => select(w.id)} className="flex min-w-0 flex-col gap-1 text-left">
        {head}
        {waits && !outcome ? <span className="text-[11px] text-[var(--muted)]">after {waits}</span> : null}
        <span className={`${outcome ? 'text-[14px]' : 'text-[13px]'} ${done ? '' : 'text-[var(--muted)]'}`}>{w.status === 'waiting' && waits ? `Waiting for ${waits}` : lineOf(w)}</span>
      </button>
      {shown.length ? (
        <ul className={`text-[12px] text-[var(--muted)] ${outcome ? 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4' : 'flex flex-col'}`}>
          {shown.map((p, i) => <li key={i} title={p.text}>{p.label}</li>)}
        </ul>
      ) : null}
      {done && rest > 0 ? (
        <button type="button" onClick={() => toggleCard(w.id)} aria-expanded={open} className="self-start text-[12px] text-[var(--muted)] hover:text-[var(--fg)]">
          {open ? '▾ fewer' : `▸ ${lead ? `${rest} more` : `${points.length} points`}`}
        </button>
      ) : null}
    </div>
  );
}

/** A request's own panel: what you asked and where each ask stands, why each agent exists, and the agents. */
function RequestPanel({ r, names, onAgent, onClose }: { r: WorkRequest; names: Map<string, string>; onAgent(id: string): void; onClose(): void }) {
  const section = 'mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';
  const content = (
    <div className="px-4 pb-4 pt-1">
      {r.words ? <><div className={section}>You asked</div><p className="text-[var(--muted)]">“{r.words}”</p></> : null}
      {r.asks.length ? (
        <><div className={section}>Asks</div>
          <ul className="flex flex-col gap-1">{r.asks.map(a => (
            <li key={a.id}><span>{a.text}</span> <span className="text-[12px] text-[var(--muted)]">· {a.status}{a.resolved ? ` by ${names.get(a.resolved.by) ?? a.resolved.by}${a.resolved.note ? `: ${a.resolved.note}` : ''}` : ''}</span></li>
          ))}</ul></>
      ) : null}
      <div className={section}>Agents</div>
      <ul className="flex flex-col gap-2">{r.workers.map(w => (
        <li key={w.id}>
          <button type="button" onClick={() => onAgent(w.id)} className="text-left hover:underline"><b className="font-medium">{w.name}</b></button>
          <span className="text-[12px] text-[var(--muted)]"> · {w.status}{waitText(r, w.id) ? ` · after ${waitText(r, w.id)}` : ''}</span>
          <div className="text-[12px]">{lineOf(w)}</div>
          {w.why ? <div className="text-[12px] text-[var(--muted)]">why: {w.why}</div> : null}
        </li>
      ))}</ul>
    </div>
  );
  return <LimbPanel title={r.title} status={r.self ? <span className="text-[12px] text-[var(--muted)]">started by the entity</span> : undefined} onClose={onClose} thread={content} log={content} />;
}

const WORKING = 'var(--yellow, #d29922)';
type DotState = 'running' | 'paused' | 'done' | 'waiting' | 'need' | 'stopped';

/** An agent's state at a glance, as in the mockup: a ring while working, filled when done, dashed while waiting. */
function dotState(w: WorkItem, paused: boolean): DotState {
  if (w.status === 'done') return 'done';
  if (w.status === 'failed' || w.status === 'cancelled' || w.status === 'killed') return 'stopped';
  if (w.status === 'queued' || w.status === 'waiting') return 'waiting';
  if (w.state === 'need') return 'need';
  return paused ? 'paused' : 'running';
}

function StateDot({ state }: { state: DotState }) {
  const color = state === 'done' ? STATE_COLOR.done : state === 'running' ? WORKING : state === 'need' ? STATE_COLOR.need : state === 'stopped' ? STATE_COLOR.stop : 'var(--muted)';
  return (
    <span title={state} className="inline-block h-2 w-2 shrink-0 rounded-full border-2"
      style={{ borderColor: color, background: state === 'done' || state === 'stopped' ? color : 'transparent', borderStyle: state === 'waiting' || state === 'paused' ? 'dashed' : 'solid' }} />
  );
}

/** What an agent waits for, in words: "all of Audit" for a whole batch, else the agents' names. */
function waitText(r: WorkRequest, id: string): string | undefined {
  if (r.waitsOnBatch[id]) return `all of ${r.waitsOnBatch[id]}`;
  const deps = r.deps[id] ?? [];
  if (!deps.length) return undefined;
  const names = deps.map(d => r.workers.find(w => w.id === d)?.name ?? d);
  return names.length > 2 ? `${names.length} agents` : names.join(' + ');
}

/** One line for an agent: its result when done, else what it is on, from its own rounds or its summary. */
function lineOf(w: WorkItem): string {
  if (w.status === 'done') return w.result ?? 'done';
  if (w.status === 'failed' || w.status === 'cancelled' || w.status === 'killed') return w.result ?? w.status;
  if (w.status === 'queued') return 'Queued: starts when another agent finishes';
  if (w.status === 'waiting') return `Waiting for ${w.label.replace(/^after /, '')}`;
  if (w.state === 'need' && w.now) return `${w.label}: ${w.now.object ?? ''}`;
  if (w.rounds && w.lastRound) return `Round ${w.rounds}: ${w.lastRound}`;
  const doing = w.steps?.doing[0];
  return doing ? `${doing}…` : w.label;
}

function Segment({ value, onChange, label, small }: { value: Zoom; onChange(z: Zoom): void; label: string; small?: boolean }) {
  return (
    <span role="group" aria-label={label} className={`inline-flex rounded border border-[var(--border)] p-px ${small ? 'mt-1 text-[11px] opacity-70 hover:opacity-100' : ''}`}>
      {(['labels', 'gists'] as const).map(z => (
        <button key={z} type="button" aria-pressed={value === z} onClick={() => onChange(z)}
          className={`rounded-sm px-2 py-0.5 capitalize ${value === z ? 'bg-[var(--panel-alt)] text-[var(--fg)]' : 'text-[var(--muted)]'}`}>{z}</button>
      ))}
    </span>
  );
}

/** The global card detail, remembered on this device. */
function useZoom(): [Zoom, (z: Zoom) => void] {
  const [zoom, setZoom] = React.useState<Zoom>(() => { try { return localStorage.getItem('entity-work-zoom') === 'labels' ? 'labels' : 'gists'; } catch { return 'gists'; } });
  return [zoom, (z: Zoom) => { setZoom(z); try { localStorage.setItem('entity-work-zoom', z); } catch { /* per-device convenience only */ } }];
}

/** The snapshot's clock only moves with events; running times should move in quiet moments too, about once a second. */
function useClock(snapshot: EntitySnapshot, live: boolean): number {
  const [now, setNow] = React.useState(() => ({ t: snapshot.t, at: Date.now() }));
  React.useEffect(() => setNow({ t: snapshot.t, at: Date.now() }), [snapshot.t]);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (!live || snapshot.status !== 'running') return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [live, snapshot.status]);
  return live && snapshot.status === 'running' ? now.t + (Date.now() - now.at) : snapshot.t;
}

const timeOfDay = (at: number) => new Date(at).toTimeString().slice(0, 5);
const toggled = (set: ReadonlySet<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };
