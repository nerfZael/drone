import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';

/**
 * The entity brain: a live, fit-to-pane map of the entity. Top to bottom it runs from the user,
 * through the body (channels and Jev's senses) and the reflexes (code limbs), to the mind (voice
 * and head) and the task limbs it spawned. Edges show structure; events travel along them.
 */

type Limb = EntitySnapshot['limbs'][number];
type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Tone = 'user' | 'entity' | 'signal' | 'sense';
type Pulse = { id: string; from: string; to: string; label?: string; tone: Tone; at: number };
type Edge = { from: string; to: string; dashed?: boolean };

const PULSE_MS = 1600;
const COMPACT_H = 26;
/** When one event crosses two edges (you → chat → mind), the second hop fires as the first lands. */
const HOP_MS = 400;
const MAX_FIRING_BATCH = 24;
const CHANNELS = ['chat', 'keypad', 'workspace'] as const;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const CHANNEL_OF: Record<string, (typeof CHANNELS)[number]> = {
  chat_message: 'chat', draft_changed: 'chat', entity_draft: 'chat',
  key_down: 'keypad', key_up: 'keypad',
  file_written: 'workspace', command_ran: 'workspace',
};
const TONE_COLOR: Record<Tone, string> = {
  user: 'var(--accent)',
  entity: 'var(--green, #3fb950)',
  signal: 'var(--yellow, #d29922)',
  sense: 'var(--cyan, #39c5cf)',
};
const ENDED = new Set(['done', 'failed', 'cancelled', 'killed']);
const isEntity = (by: string) => by !== 'user' && by !== 'host' && by !== 'system';
const lastOf = <T,>(list: readonly T[], test: (item: T) => boolean = () => true): T | undefined => { for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i]; return undefined; };
const clip = (text: unknown, n: number) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const channelId = (name: string) => `ch:${name}`;
const senseName = (level: string) => level.replace(/^sense\./, '');
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

/** `live` false (replay): the clock stops at the snapshot's time instead of running on. */
export function EntityBrain({ events, snapshot, live = true }: { events: EntityEvent[]; snapshot: EntitySnapshot; live?: boolean }) {
  const container = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [selected, setSelected] = React.useState<string | null>(null);
  React.useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const limbs = React.useMemo(() => new Map(snapshot.limbs.map((l) => [l.id, l])), [snapshot.limbs]);
  const allPulses = usePulses(events, snapshot, limbs);
  const clock = useEntityClock(snapshot, live);
  const recent = React.useMemo(() => recentActivity(events), [events]);
  const layout = React.useMemo(() => layoutBrain(size.w, size.h, snapshot), [size.w, size.h, snapshot]);
  const edges = React.useMemo(() => structuralEdges(snapshot, layout.rects), [snapshot, layout.rects]);
  React.useEffect(() => { if (selected && !layout.rects.has(selected)) setSelected(null); }, [layout.rects, selected]);

  const now = performance.now();
  const pulses = allPulses.filter((p) => p.at <= now);
  const hot = new Map<string, Tone>();
  for (const p of pulses) { hot.set(p.from, p.tone); hot.set(p.to, p.tone); }
  const edgeKey = (a: string, b: string) => `${a}→${b}`;
  const structural = new Set(edges.map((e) => edgeKey(e.from, e.to)));
  const pulseOn = (e: Edge) => lastOf(pulses, (p) => (p.from === e.from && p.to === e.to) || (p.from === e.to && p.to === e.from));
  const transient = pulses.filter((p) => !structural.has(edgeKey(p.from, p.to)) && !structural.has(edgeKey(p.to, p.from)));
  const labels = placeLabels(pulses.filter((p) => p.label).slice(-8), layout.rects);

  return (
    <section className="relative flex min-h-0 flex-col overflow-hidden bg-[var(--panel)]" aria-label="Entity brain">
      <BrainStrip snapshot={snapshot} />
      <div ref={container} className="relative min-h-0 flex-1 overflow-hidden" data-entity-brain="" onClick={() => setSelected(null)}>
        {size.w > 0 ? (
          <>
            {layout.bands.map((band) => (
              <div key={band.title} className="pointer-events-none absolute left-2.5 text-[9px] uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ top: band.y - 13 }}>
                {band.title}{band.hidden ? ` · +${band.hidden} ended` : ''}
              </div>
            ))}
            <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden>
              {edges.map((edge) => {
                const a = layout.rects.get(edge.from); const b = layout.rects.get(edge.to);
                if (!a || !b) return null;
                const pulse = pulseOn(edge);
                const lit = selected !== null && (edge.from === selected || edge.to === selected);
                return <BrainEdge key={edgeKey(edge.from, edge.to)} a={a} b={b} dashed={edge.dashed} lit={lit} pulse={pulse} now={now} />;
              })}
              {transient.map((p) => {
                const a = layout.rects.get(p.from); const b = layout.rects.get(p.to);
                return a && b ? <BrainEdge key={p.id} a={a} b={b} pulse={p} transient now={now} /> : null;
              })}
            </svg>
            {[...layout.rects.entries()].map(([id, rect]) => (
              <div key={id} className="absolute z-10 transition-[left,top,width,height] duration-300 ease-out" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
                <BrainNode id={id} compact={layout.compact.has(id)} snapshot={snapshot} limb={limbs.get(id)} recent={recent} hot={hot.get(id)} events={events}
                  clock={clock} selected={selected === id} onSelect={() => setSelected((current) => (current === id ? null : id))} />
              </div>
            ))}
            <svg className="pointer-events-none absolute inset-0 z-[15]" width={size.w} height={size.h} aria-hidden>
              {pulses.map((p) => {
                const a = layout.rects.get(p.from); const b = layout.rects.get(p.to);
                return a && b ? <Firing key={p.id} points={connect(a, b)} color={TONE_COLOR[p.tone]} /> : null;
              })}
            </svg>
            {labels.map(({ pulse, at }) => (
              <div key={`label-${pulse.id}`} className="pointer-events-none absolute z-20 max-w-[180px] -translate-x-1/2 -translate-y-1/2 truncate rounded border bg-[var(--panel-raised)] px-1.5 py-px text-[10px] shadow-sm"
                style={{ left: at.x, top: at.y, borderColor: TONE_COLOR[pulse.tone], color: 'var(--fg)', opacity: Math.max(0, 1 - (now - pulse.at) / PULSE_MS) }}>
                {pulse.label}
              </div>
            ))}
            {selected ? <NodeDetails id={selected} snapshot={snapshot} limb={limbs.get(selected)} events={events} clock={clock} onClose={() => setSelected(null)} /> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Status line across the top: session state, output stops and Jev spend. */
function BrainStrip({ snapshot }: { snapshot: EntitySnapshot }) {
  const thinking = snapshot.limbs.filter((l) => l.runs.length).length;
  const reflexes = snapshot.limbs.filter((l) => l.kind === 'code' && !ENDED.has(l.status)).length;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--muted)]">
      <span className="font-medium text-[var(--fg)]">Brain</span>
      <span>{thinking ? `${thinking} thinking` : 'quiet'}</span>
      <span>{reflexes} reflex{reflexes === 1 ? '' : 'es'} armed</span>
      {snapshot.jev.available ? <span>{snapshot.senses.length} senses · {snapshot.jev.calls} calls</span> : null}
      {snapshot.stops.map((stop) => (
        <span key={stop.id} className="rounded border border-[var(--red)] px-1.5 text-[var(--red)]" title={`${stop.scope} · ${stop.mode} · by ${stop.by}`}>
          output stopped ({stop.owner}): {clip(stop.reason, 40)}
        </span>
      ))}
      <span className="ml-auto text-[var(--muted-dim)]">click a node for details</span>
    </div>
  );
}

function BrainEdge({ a, b, dashed, lit, pulse, transient, now }: {
  a: Rect; b: Rect; dashed?: boolean; lit?: boolean; pulse?: Pulse; transient?: boolean; now: number;
}) {
  const points = connect(a, b);
  const d = pathOf(points);
  const fade = pulse ? Math.max(0, 1 - (now - pulse.at) / PULSE_MS) : 0;
  return (
    <g>
      <path d={d} fill="none" stroke={lit ? 'var(--accent)' : 'var(--border)'} strokeWidth={lit ? 1.75 : 1.25}
        strokeDasharray={dashed || transient ? '3 4' : undefined} opacity={transient ? fade * 0.8 : lit ? 0.9 : dashed ? 0.5 : 0.85} />
      {pulse ? <path d={d} fill="none" stroke={TONE_COLOR[pulse.tone]} strokeWidth={2} opacity={fade * 0.7} strokeLinecap="round" /> : null}
    </g>
  );
}

/**
 * One signal travelling an edge, in its direction: a comet with a bright spark at its head, then
 * an arrowhead and a ping where it lands. Mounted once per pulse, so the CSS animations play once.
 */
function Firing({ points, color }: { points: [Point, Point, Point, Point]; color: string }) {
  const d = pathOf(points);
  const [, , p2, p3] = points;
  // Arrive along the curve's final tangent; fall back to straight down for degenerate curves.
  const angle = Math.hypot(p3.x - p2.x, p3.y - p2.y) > 0.5 ? Math.atan2(p3.y - p2.y, p3.x - p2.x) * 180 / Math.PI : 90;
  return (
    <g style={{ color }}>
      <path d={d} pathLength={100} fill="none" stroke="currentColor" strokeWidth={7} strokeLinecap="round" opacity={0.25} className="brain-comet" />
      <path d={d} pathLength={100} fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" className="brain-comet" />
      <circle r={3.25} fill="var(--fg-strong, #fff)" className="brain-spark"
        style={{ offsetPath: `path('${d}')`, filter: `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 6px ${color})` }} />
      <polygon points="-7,-4.5 0,0 -7,4.5" fill="currentColor" className="brain-arrow" transform={`translate(${p3.x} ${p3.y}) rotate(${angle})`} />
      <circle cx={p3.x} cy={p3.y} r={5} fill="none" stroke="currentColor" strokeWidth={1.5} className="brain-ping" />
    </g>
  );
}

function BrainNode({ id, compact, snapshot, limb, recent, hot, events, clock, selected, onSelect }: {
  id: string; compact: boolean; snapshot: EntitySnapshot; limb?: Limb; recent: Map<string, string>; hot?: Tone; events: EntityEvent[];
  clock: () => number; selected: boolean; onSelect(): void;
}) {
  const busy = !!limb?.runs.length;
  const ended = limb ? ENDED.has(limb.status) : false;
  const failed = limb?.status === 'failed' || limb?.status === 'killed';
  const stopped = limb ? snapshot.stops.some((s) => s.owner === limb.id) : false;
  const border = failed || stopped ? 'var(--red)' : hot ? TONE_COLOR[hot] : selected || busy ? 'var(--accent)' : 'var(--border-subtle)';
  const glow = hot ? `0 0 0 1px ${TONE_COLOR[hot]}, 0 0 14px -2px ${TONE_COLOR[hot]}` : selected ? '0 0 0 1px var(--accent)' : busy ? 'var(--glow-accent)' : undefined;
  const content = nodeContent(id, compact, snapshot, limb, recent, events, clock);
  return (
    <button type="button" data-brain-node={id} aria-pressed={selected}
      className={`flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-lg border bg-[var(--panel-alt)] px-2 py-1 text-left text-[11px] leading-[1.35] transition-[border-color,box-shadow,opacity] duration-200 animate-card-enter hover:bg-[var(--panel-raised)] ${busy ? 'animate-border-glow' : ''}`}
      style={{ borderColor: border, opacity: ended && !selected ? 0.5 : 1, boxShadow: glow }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <div className="flex w-full min-w-0 items-center gap-1.5">
        <StatusDot state={failed ? 'failed' : busy ? 'busy' : ended ? 'ended' : content.live ? 'live' : 'idle'} />
        <span className="min-w-[3em] shrink-0 truncate font-medium text-[var(--fg)]" style={{ maxWidth: '62%' }}>{content.name}</span>
        {content.badge ? <span className="ml-auto min-w-0 truncate text-[10px] text-[var(--muted)]">{content.badge}</span> : null}
      </div>
      {!compact ? <div className="min-h-0 w-full flex-1 overflow-hidden text-[var(--muted)]">{content.body}</div> : null}
    </button>
  );
}

function StatusDot({ state }: { state: 'busy' | 'live' | 'idle' | 'ended' | 'failed' }) {
  const color = state === 'busy' ? 'var(--accent)' : state === 'live' ? 'var(--green, #3fb950)' : state === 'failed' ? 'var(--red)' : 'var(--muted-dim)';
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${state === 'busy' ? 'animate-pulse-dot' : ''}`} style={{ background: color }} />;
}

type ChatWorld = { draft?: { text: string } | null; entityDraft?: { by: string; text: string } | null; messages?: { by: string; text: string }[] };
type KeypadWorld = { held?: Record<string, { by: string }> };

function nodeContent(id: string, compact: boolean, snapshot: EntitySnapshot, limb: Limb | undefined, recent: Map<string, string>, events: EntityEvent[], clock: () => number): {
  name: string; badge?: string; body: React.ReactNode; live?: boolean;
} {
  const chat = snapshot.world.chat as ChatWorld | undefined;
  const keypad = snapshot.world.keypad as KeypadWorld | undefined;
  if (id === 'you') {
    const held = Object.entries(keypad?.held ?? {}).filter(([, h]) => h.by === 'user').map(([k]) => k);
    const doing = chat?.draft?.text ? 'typing…' : held.length ? `holding ${held.join(' ')}` : '';
    return { name: 'You', badge: compact ? doing : undefined, body: doing || 'watching', live: !!doing };
  }
  if (id === channelId('chat')) {
    const last = lastOf(chat?.messages ?? []);
    const typing = chat?.draft?.text ? 'you typing' : chat?.entityDraft?.text ? `${chat.entityDraft.by} typing` : '';
    return {
      name: 'Chat', badge: compact && typing ? typing : `${chat?.messages?.length ?? 0} msgs`, live: !!typing,
      body: (
        <>
          {chat?.draft?.text ? <div className="truncate italic">you typing: {clip(chat.draft.text, 80)}</div> : null}
          {chat?.entityDraft?.text ? <div className="truncate italic" style={{ color: TONE_COLOR.entity }}>{chat.entityDraft.by} typing: {clip(chat.entityDraft.text, 80)}</div> : null}
          {last ? <div className="line-clamp-2">{last.by}: {clip(last.text, 140)}</div> : <div>no messages yet</div>}
        </>
      ),
    };
  }
  if (id === channelId('keypad')) {
    const held = keypad?.held ?? {};
    const heldKeys = Object.keys(held);
    return {
      name: 'Keypad', badge: heldKeys.length ? (compact ? `holding ${heldKeys.join(' ')}` : `${heldKeys.length} held`) : undefined, live: heldKeys.length > 0,
      body: (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {KEYS.map((key) => {
            const by = held[key]?.by;
            const color = by === 'user' ? TONE_COLOR.user : by ? TONE_COLOR.entity : undefined;
            return (
              <span key={key} className="flex h-4 w-4 items-center justify-center rounded-sm border text-[9px]"
                style={{ borderColor: color ?? 'var(--border-subtle)', background: color ? `color-mix(in srgb, ${color} 35%, transparent)` : undefined, color: color ? 'var(--fg)' : undefined }}>
                {key}
              </span>
            );
          })}
        </div>
      ),
    };
  }
  if (id === channelId('workspace')) {
    const last = lastOf(events, (e) => e.type === 'file_written' || e.type === 'command_ran');
    const summary = last ? (last.type === 'file_written' ? `${last.by} wrote ${String(last.data.path)}` : `${last.by} ran ${clip(last.data.command, 60)} → ${String(last.data.exit)}`) : 'untouched';
    return { name: 'Workspace', badge: compact && last ? summary : undefined, body: summary };
  }
  if (id === 'jev') {
    const strongest = [...snapshot.senses].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))[0];
    return {
      name: 'Senses', live: snapshot.senses.length > 0,
      badge: !snapshot.jev.available ? 'off' : compact && strongest ? `${senseName(strongest.level)} ${strongest.value?.toFixed(2) ?? '–'}` : `${snapshot.jev.calls} calls`,
      body: !snapshot.jev.available ? 'No evaluator: judge and sense are off.' : snapshot.senses.length === 0 ? 'Nothing sensed yet.' : (
        <div className="mt-0.5 space-y-0.5">
          {snapshot.senses.map((sense) => (
            <div key={sense.id} className="flex items-center gap-1.5" title={sense.question}>
              <span className="min-w-0 flex-1 truncate">{senseName(sense.level)}</span>
              <SenseBar value={sense.value} />
            </div>
          ))}
        </div>
      ),
    };
  }
  if (!limb) return { name: id, body: null };
  const model = limb.model?.split('/')[1];
  const latest = recent.get(limb.id);
  if (limb.kind === 'code') {
    const trigger = limb.watch ? describeTrigger(limb.watch.on as Record<string, unknown>) : 'program';
    return {
      name: limb.name, badge: limb.fires ? `fired ${limb.fires}×` : limb.status,
      body: (
        <>
          <div className="truncate">{trigger}</div>
          {latest ? <div className="truncate text-[var(--fg-secondary)]">{latest}</div> : null}
        </>
      ),
    };
  }
  const oldest = limb.runs.reduce<number | null>((min, r) => (min === null || r.startedAt < min ? r.startedAt : min), null);
  const status = oldest !== null ? `thinking ${seconds(clock() - oldest)}${limb.runs.length > 1 ? ` ×${limb.runs.length}` : ''}` : limb.status;
  const reasons = limb.runs.map((r) => r.reason).filter(Boolean);
  return {
    name: limb.role === 'task' ? limb.name : limb.role === 'voice' ? 'Voice' : 'Head',
    badge: compact ? status : [model, status].filter(Boolean).join(' · '),
    body: (
      <>
        {limb.task ? <div className="line-clamp-2">{clip(limb.task, 160)}</div> : null}
        {reasons.length && limb.role !== 'task' ? <div className="truncate" style={{ color: 'var(--accent)' }}>woke: {clip(lastOf(reasons), 80)}</div> : null}
        {limb.result ? <div className="line-clamp-2 text-[var(--fg-secondary)]">→ {clip(limb.result, 160)}</div>
          : latest ? <div className="line-clamp-2 text-[var(--fg-secondary)]">{latest}</div> : null}
      </>
    ),
  };
}

function SenseBar({ value }: { value?: number }) {
  return (
    <>
      <span className="h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round((value ?? 0) * 100)}%`, background: TONE_COLOR.sense }} />
      </span>
      <span className="w-7 shrink-0 text-right font-mono text-[10px]">{value === undefined ? '–' : value.toFixed(2)}</span>
    </>
  );
}

/** Everything about one node, over the bottom of the brain: config, runs, and its recent events. */
function NodeDetails({ id, snapshot, limb, events, clock, onClose }: {
  id: string; snapshot: EntitySnapshot; limb?: Limb; events: EntityEvent[]; clock: () => number; onClose(): void;
}) {
  const channel = id.startsWith('ch:') ? id.slice(3) : null;
  const related = events.filter((e) =>
    id === 'you' ? e.by === 'user'
      : channel ? CHANNEL_OF[e.type] === channel && e.type !== 'draft_changed'
      : id === 'jev' ? e.type === 'judged' || e.type === 'jev_unavailable'
      : e.by === id || e.data.id === id || e.data.limb === id,
  ).slice(-14).reverse();
  const title = limb ? `${limb.name} · ${limb.id}` : id === 'jev' ? 'Senses' : id === 'you' ? 'You' : channel ? channel[0].toUpperCase() + channel.slice(1) : id;
  const rows: [string, React.ReactNode][] = limb ? [
    ['kind', `${limb.kind} · ${limb.role}${limb.model ? ` · ${limb.model}` : ''}`],
    ['status', limb.status],
    ...(limb.parent ? [['parent', limb.parent] as [string, React.ReactNode]] : []),
    ...limb.runs.map((r): [string, React.ReactNode] => [`run ${r.id}`, `${seconds(clock() - r.startedAt)} · ${r.reason}`]),
    ...(limb.task ? [['task', limb.task] as [string, React.ReactNode]] : []),
    ...(limb.result ? [['result', limb.result] as [string, React.ReactNode]] : []),
    ...(limb.watch ? [['watch', <pre key="w" className="whitespace-pre-wrap">{JSON.stringify(limb.watch, null, 1)}</pre>] as [string, React.ReactNode]] : []),
    ...(limb.code ? [['code', <pre key="c" className="whitespace-pre-wrap">{limb.code}</pre>] as [string, React.ReactNode]] : []),
    ...(limb.fires ? [['fired', `${limb.fires}×`] as [string, React.ReactNode]] : []),
  ] : id === 'jev' ? snapshot.senses.map((s): [string, React.ReactNode] => [
    senseName(s.level),
    <span key={s.id} className="flex items-center gap-1.5"><SenseBar value={s.value} /><span className="min-w-0">{s.question} <span className="text-[var(--muted-dim)]">· {s.owners.join(', ')}</span></span></span>,
  ]) : [];
  return (
    <div className="absolute inset-x-2 bottom-2 z-30 flex max-h-[48%] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] shadow-lg animate-slide-up"
      role="dialog" aria-label={`${title} details`} onClick={(e) => e.stopPropagation()}>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 text-[12px]">
        <span className="font-medium text-[var(--fg)]">{title}</span>
        <button type="button" className="ml-auto rounded px-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]" onClick={onClose} aria-label="Close details">✕</button>
      </div>
      <div className="min-h-0 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.45]">
        {rows.map(([key, value], i) => (
          <div key={`${key}-${i}`} className="flex gap-2"><span className="w-16 shrink-0 truncate text-[var(--muted-dim)]">{key}</span><span className="min-w-0 flex-1 break-words text-[var(--fg-secondary)]">{value}</span></div>
        ))}
        <div className={`${rows.length ? 'mt-2' : ''} mb-0.5 font-sans text-[var(--muted-dim)]`}>{related.length ? 'Recent events' : 'No events yet'}</div>
        {related.map((e) => (
          <div key={e.seq} className="truncate text-[var(--muted)]">
            <span className="text-[var(--muted-dim)]">{seconds(e.t)}</span> {e.by} <span className="text-[var(--accent)]">{e.type}</span> {JSON.stringify(e.data).slice(0, 200)}
          </div>
        ))}
      </div>
    </div>
  );
}

function describeTrigger(on: Record<string, unknown>): string {
  if (typeof on.event === 'string') return `on ${on.event}${on.key !== undefined ? ` ${String(on.key)}` : ''}${on.by && on.by !== 'user' ? ` by ${String(on.by)}` : ''}`;
  if (typeof on.level === 'string') return `on ${on.level}`;
  return `on ${clip(JSON.stringify(on), 40)}`;
}

/** The newest thing each limb did, in a few words: what it said, logged, pressed or reported. */
function recentActivity(events: EntityEvent[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (let i = events.length - 1; i >= 0 && i >= events.length - 600; i--) {
    const e = events[i];
    if (!isEntity(e.by) || latest.has(e.by)) continue;
    const text = e.type === 'chat_message' ? `said “${clip(e.data.text, 120)}”`
      : e.type === 'task_progress' ? clip(e.data.text, 140)
      : e.type === 'program_log' ? clip(e.data.message, 120)
      : e.type === 'key_down' ? `pressed ${String(e.data.key)}`
      : e.type === 'handoff' ? `handed off: ${clip(e.data.note, 100)}`
      : e.type === 'file_written' ? `wrote ${String(e.data.path)}`
      : e.type === 'note' ? `noted ${clip(e.data.text ?? JSON.stringify(e.data), 100)}`
      : '';
    if (text) latest.set(e.by, text);
  }
  return latest;
}

/** Entity time now, extrapolated from the last snapshot; ticks while any limb is thinking. */
function useEntityClock(snapshot: EntitySnapshot, live: boolean): () => number {
  const received = React.useMemo(() => ({ t: snapshot.t, at: performance.now() }), [snapshot]);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  const running = live && snapshot.status === 'running';
  const thinking = running && snapshot.limbs.some((l) => l.runs.length);
  React.useEffect(() => {
    if (!thinking) return;
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [thinking]);
  return () => received.t + (running ? performance.now() - received.at : 0);
}

/** Events since mount, turned into short-lived pulses along the edge they travelled. */
function usePulses(events: EntityEvent[], snapshot: EntitySnapshot, limbs: Map<string, Limb>): Pulse[] {
  const [pulses, setPulses] = React.useState<Pulse[]>([]);
  const lastSeq = React.useRef<number | null>(null);
  const context = React.useRef({ snapshot, limbs });
  context.current = { snapshot, limbs };

  React.useEffect(() => {
    const newest = lastOf(events)?.seq ?? 0;
    // Start from now on mount and after a reset: history is not replayed as motion.
    if (lastSeq.current === null || newest < lastSeq.current) { lastSeq.current = newest; return; }
    const since = lastSeq.current;
    lastSeq.current = newest;
    const at = performance.now();
    const added = events.filter((e) => e.seq > since);
    // A big jump (scrubbing a replay, a reconnect) is not motion: only a few new events fire.
    const fresh = added.length > MAX_FIRING_BATCH ? [] : added.flatMap((e) => pulsesFor(e, context.current.snapshot, context.current.limbs, at));
    if (fresh.length) setPulses((current) => [...current.filter((p) => at - p.at < PULSE_MS), ...fresh].slice(-40));
  }, [events]);

  // Re-render while anything is in flight so pulses fade, then stop ticking.
  const active = pulses.length > 0;
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const now = performance.now();
      setPulses((current) => current.filter((p) => now - p.at < PULSE_MS));
    }, 80);
    return () => clearInterval(timer);
  }, [active]);

  return pulses;
}

function pulsesFor(e: EntityEvent, snapshot: EntitySnapshot, limbs: Map<string, Limb>, at: number): Pulse[] {
  const pulse = (from: string, to: string | undefined, tone: Tone, label?: string, delay = 0): Pulse[] =>
    to ? [{ id: `${e.seq}:${from}:${to}`, from, to, tone, label, at: at + delay }] : [];
  const channel = CHANNEL_OF[e.type];
  const mind = limbs.has('voice') ? 'voice' : 'head';
  if (e.by === 'user' && channel) {
    const label = e.type === 'chat_message' ? `“${clip(e.data.text, 40)}”` : e.type === 'key_down' ? `↓${String(e.data.key)}` : e.type === 'key_up' ? `↑${String(e.data.key)}` : undefined;
    return [...pulse('you', channelId(channel), 'user', label), ...(e.type === 'chat_message' ? pulse(channelId(channel), mind, 'user', undefined, HOP_MS) : [])];
  }
  if (e.type === 'sensed') {
    const answers = (e.data.answers ?? {}) as Record<string, number>;
    return snapshot.senses.filter((s) => typeof answers[s.level] === 'number')
      .flatMap((s) => s.owners.filter((o) => limbs.has(o)).flatMap((o) => pulse('jev', o, 'sense', `${senseName(s.level)} ${answers[s.level].toFixed(2)}`)));
  }
  if (!isEntity(e.by) || !limbs.has(e.by)) return [];
  const parent = limbs.get(e.by)?.parent;
  if (channel) {
    const label = e.type === 'chat_message' ? `“${clip(e.data.text, 40)}”` : e.type === 'key_down' ? `↓${String(e.data.key)}`
      : e.type === 'file_written' ? String(e.data.path) : e.type === 'command_ran' ? clip(e.data.command, 30) : undefined;
    return pulse(e.by, channelId(channel), 'entity', label);
  }
  switch (e.type) {
    case 'watch_woke': return pulse(e.by, String(e.data.limb ?? parent), 'signal', `wake: ${clip(e.data.reason, 30)}`);
    case 'limb_spawned': return pulse(e.by, String(e.data.id), 'signal', `spawn ${clip(e.data.name, 24)}`);
    case 'watch_installed': return pulse(e.by, String(e.data.id), 'signal', 'install watch');
    case 'program_started': return pulse(e.by, String(e.data.id), 'signal', 'run program');
    case 'steered': return pulse(e.by, String(e.data.id), 'signal', `steer: ${clip(e.data.text, 30)}`);
    case 'task_progress': return pulse(e.by, parent, 'signal', clip(e.data.text, 40));
    case 'task_done': return pulse(e.by, parent, 'signal', `done: ${clip(e.data.result, 36)}`);
    case 'handoff': return pulse(e.by, 'head', 'signal', `handoff: ${clip(e.data.note, 30)}`);
    case 'judged': return pulse('jev', e.by, 'sense', `judge ${Number(e.data.p).toFixed(2)}`);
    default: return [];
  }
}

function structuralEdges(snapshot: EntitySnapshot, rects: Map<string, Rect>): Edge[] {
  const edges: Edge[] = [];
  const mind = snapshot.limbs.some((l) => l.id === 'voice') ? 'voice' : 'head';
  for (const name of CHANNELS) {
    edges.push({ from: 'you', to: channelId(name) });
    edges.push({ from: channelId(name), to: mind, dashed: true });
  }
  for (const limb of snapshot.limbs) {
    if (limb.parent && limb.id !== 'voice') edges.push({ from: limb.parent, to: limb.id });
    const event = (limb.watch?.on as { event?: unknown } | undefined)?.event;
    const channel = typeof event === 'string' ? CHANNEL_OF[event] : undefined;
    if (channel) edges.push({ from: channelId(channel), to: limb.id, dashed: true });
  }
  if (mind === 'voice') edges.push({ from: 'voice', to: 'head' });
  for (const sense of snapshot.senses) for (const owner of sense.owners) edges.push({ from: 'jev', to: owner, dashed: true });
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    if (seen.has(key) || !rects.has(e.from) || !rects.has(e.to)) return false;
    seen.add(key);
    return true;
  });
}

type Item = { id: string; h: number; ended?: boolean };
type BandSpec = { title: string; items: Item[]; minW: number; maxW: number };
type Band = { title: string; y: number; hidden: number };

/**
 * Horizontal bands stacked top to bottom, each wrapping its nodes into as many rows as its width
 * needs. When the pane is too short, rows shrink toward header-only nodes, then ended limbs are
 * dropped oldest first (and counted in the band title) until everything fits.
 */
function layoutBrain(width: number, height: number, snapshot: EntitySnapshot): { rects: Map<string, Rect>; compact: Set<string>; bands: Band[] } {
  const rects = new Map<string, Rect>();
  const compact = new Set<string>();
  const bands: Band[] = [];
  if (!width || !height) return { rects, compact, bands };
  const code = snapshot.limbs.filter((l) => l.kind === 'code');
  const tasks = snapshot.limbs.filter((l) => l.role === 'task');
  const mind = ['voice', 'head'].flatMap((role) => snapshot.limbs.filter((l) => l.role === role));
  const specs: BandSpec[] = [
    { title: 'You', items: [{ id: 'you', h: 40 }], minW: 110, maxW: 170 },
    { title: 'Body', minW: 130, maxW: 240, items: [
      { id: channelId('chat'), h: 80 }, { id: channelId('keypad'), h: 80 }, { id: channelId('workspace'), h: 80 },
      { id: 'jev', h: Math.min(110, 34 + 17 * Math.max(1, snapshot.senses.length)) },
    ] },
    ...(code.length ? [{ title: 'Reflexes', minW: 130, maxW: 220, items: code.map((l) => ({ id: l.id, h: 54, ended: ENDED.has(l.status) })) }] : []),
    { title: 'Mind', minW: 180, maxW: 320, items: mind.map((l) => ({ id: l.id, h: 84 })) },
    ...(tasks.length ? [{ title: 'Tasks', minW: 160, maxW: 280, items: tasks.map((l) => ({ id: l.id, h: 84, ended: ENDED.has(l.status) })) }] : []),
  ];
  const pad = 10; const hgap = 10; const vgap = 8; const label = 17;
  const innerW = width - pad * 2;
  const plan = (spec: BandSpec) => {
    const cols = Math.max(1, Math.min(spec.items.length, Math.floor((innerW + hgap) / (spec.minW + hgap))));
    const rows: Item[][] = [];
    for (let i = 0; i < spec.items.length; i += cols) rows.push(spec.items.slice(i, i + cols));
    const full = rows.map((row) => Math.max(...row.map((i) => i.h)));
    return { cols, rows, full, pref: full.reduce((a, b) => a + b, 0) + vgap * (rows.length - 1), min: rows.length * COMPACT_H + vgap * (rows.length - 1) };
  };
  const hidden = specs.map(() => 0);
  let plans = specs.map(plan);
  const room = () => height - pad - label * specs.length - pad * (specs.length - 1);
  // Too tall even with header-only nodes: drop ended limbs, from the band with the most rows first.
  while (plans.reduce((sum, p) => sum + p.min, 0) > room()) {
    const candidates = specs.map((s, i) => ({ i, rows: plans[i].rows.length, index: s.items.findIndex((it) => it.ended) })).filter((c) => c.index >= 0);
    if (!candidates.length) break;
    const pick = candidates.sort((a, b) => b.rows - a.rows)[0];
    specs[pick.i].items.splice(pick.index, 1);
    hidden[pick.i]++;
    plans = specs.map(plan);
  }
  const pref = plans.reduce((sum, p) => sum + p.pref, 0);
  const min = plans.reduce((sum, p) => sum + p.min, 0);
  const available = room();
  // 1: everything at full size; 0: every node header-only.
  const scale = pref <= available ? 1 : Math.max(0, (available - min) / Math.max(1, pref - min));
  // Leftover height widens the gaps between bands (up to a point) and centres the rest.
  const spare = Math.max(0, available - (scale === 1 ? pref : available));
  const extraGap = Math.min(28, spare / Math.max(1, specs.length - 1));
  const used = (scale === 1 ? pref : available) + extraGap * (specs.length - 1);
  let y = pad + Math.max(0, (available - used) / 2) + label;
  specs.forEach((spec, bi) => {
    const p = plans[bi];
    bands.push({ title: spec.title, y, hidden: hidden[bi] });
    p.rows.forEach((row, ri) => {
      const rowH = Math.max(COMPACT_H, COMPACT_H + (p.full[ri] - COMPACT_H) * scale);
      const w = Math.min(spec.maxW, (innerW - hgap * (p.cols - 1)) / p.cols);
      let x = pad + (innerW - (w * row.length + hgap * (row.length - 1))) / 2;
      for (const item of row) {
        rects.set(item.id, { x, y, w, h: rowH });
        if (rowH < 40) compact.add(item.id);
        x += w + hgap;
      }
      y += rowH + (ri < p.rows.length - 1 ? vgap : 0);
    });
    y += pad + label + extraGap;
  });
  return { rects, compact, bands };
}

/** Edge anchors: bottom to top between bands, fanned across the node's edge; side to side within a row. */
function connect(a: Rect, b: Rect): [Point, Point, Point, Point] {
  const ax = a.x + a.w / 2; const bx = b.x + b.w / 2;
  const fan = (from: Rect, towards: number) => from.x + from.w / 2 + Math.max(-from.w / 3, Math.min(from.w / 3, (towards - (from.x + from.w / 2)) * 0.2));
  if (b.y >= a.y + a.h - 1 || a.y >= b.y + b.h - 1) {
    const down = b.y >= a.y + a.h - 1;
    const p0 = { x: fan(a, bx), y: down ? a.y + a.h : a.y };
    const p3 = { x: fan(b, ax), y: down ? b.y : b.y + b.h };
    const dy = Math.max(14, Math.abs(p3.y - p0.y) / 2) * (down ? 1 : -1);
    return [p0, { x: p0.x, y: p0.y + dy }, { x: p3.x, y: p3.y - dy }, p3];
  }
  const right = bx > ax;
  const p0 = { x: right ? a.x + a.w : a.x, y: a.y + a.h / 2 };
  const p3 = { x: right ? b.x : b.x + b.w, y: b.y + b.h / 2 };
  const dx = Math.max(12, Math.abs(p3.x - p0.x) / 2) * (right ? 1 : -1);
  return [p0, { x: p0.x + dx, y: p0.y }, { x: p3.x - dx, y: p3.y }, p3];
}

const pathOf = ([p0, p1, p2, p3]: Point[]) => `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
const bezierAt = ([p0, p1, p2, p3]: Point[], t: number): Point => {
  const u = 1 - t;
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
};

const LABEL_STOPS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

/**
 * Puts each label beside its edge (so the firing stays visible) where it covers no node and no
 * other label, trying points along the edge and both sides; on the midpoint if nowhere is clear.
 */
function placeLabels(pulses: Pulse[], rects: Map<string, Rect>): { pulse: Pulse; at: Point }[] {
  const placed: { pulse: Pulse; at: Point; box: Rect }[] = [];
  const nodes = [...rects.values()];
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const pulse of pulses) {
    const a = rects.get(pulse.from); const b = rects.get(pulse.to);
    if (!a || !b) continue;
    const curve = connect(a, b);
    const w = Math.min(180, 12 + 5.6 * (pulse.label?.length ?? 0)); const h = 16;
    const boxAt = (p: Point): Rect => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
    const free = (p: Point) => { const box = boxAt(p); return !nodes.some((n) => overlaps(box, n)) && !placed.some((l) => overlaps(box, l.box)); };
    let best: Point | null = null;
    for (const t of LABEL_STOPS) {
      const on = bezierAt(curve, t);
      const ahead = bezierAt(curve, Math.min(1, t + 0.02));
      // Step off the edge across its direction: sideways on vertical runs, up or down on horizontal ones.
      const vertical = Math.abs(ahead.y - on.y) >= Math.abs(ahead.x - on.x);
      const beside = vertical ? [{ x: on.x + w / 2 + 7, y: on.y }, { x: on.x - w / 2 - 7, y: on.y }] : [{ x: on.x, y: on.y - h / 2 - 5 }, { x: on.x, y: on.y + h / 2 + 5 }];
      best = beside.find(free) ?? null;
      if (best) break;
    }
    best ??= LABEL_STOPS.map((t) => bezierAt(curve, t)).find(free) ?? bezierAt(curve, 0.5);
    placed.push({ pulse, at: best, box: boxAt(best) });
  }
  return placed;
}
