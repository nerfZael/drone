import * as React from 'react';
import { Background, BaseEdge, Handle, Position, ReactFlow, ViewportPortal, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { Dot, Pips, Steps, STATE_COLOR, WorkerDetail, clock, spend, type WorkItem } from './EntityWork';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import {
  CARD_W, LINE_W, cardId, deriveCanvas, foldId, groupId, layoutCanvas, lineId, moreId,
  type CanvasModel, type CardNode, type Chip, type FoldRow, type GroupNode, type MoreNode, type OriginLine, type WorkRow,
} from './work-canvas-model';

/**
 * The Work tab as a map: one row per message that started work, in time order, with the work in lineage
 * columns to its right. Everything that needs nothing from you folds into thin lines. See
 * entity/docs/work-canvas.md. Layout is ours (work-canvas-model.ts); xyflow only pans, zooms and draws.
 */

type OnWorker = (id: string, action: 'message' | 'stop' | 'rename', text?: string) => void;

/** What the chat and the canvas highlight together: a chat message, or a worker. */
export type WorkLink = { message?: number; worker?: string; from?: 'chat' | 'canvas' } | null;

interface Ctx {
  t: number;
  live: boolean;
  focus: Set<string> | null;
  selected: string | null;
  expanded: ReadonlySet<string>;
  flashing: ReadonlySet<string>;
  nameOf(id: string): string;
  shownAs(id: string): string | undefined;
  select(id: string | null): void;
  hover(ids: string[] | null, link?: WorkLink): void;
  toggleExpanded(id: string): void;
  toggleFold(key: string): void;
  rename(id: string, name: string): void;
  reroute?(seq: number, how: 'separate' | 'fork'): void;
}
const CanvasCtx = React.createContext<Ctx | null>(null);
const useCtx = () => React.useContext(CanvasCtx)!;

type LineData = { line: OriginLine; nested: boolean };
type CardData = { card: CardNode };
type GroupData = { group: GroupNode };
type FoldData = { fold: FoldRow };
type MoreData = { more: MoreNode };
type WorkNode = Node<LineData, 'line'> | Node<CardData, 'card'> | Node<GroupData, 'batch'> | Node<FoldData, 'fold'> | Node<MoreData, 'more'>;
type WorkEdge = Edge<{ path: string; kind: 'fork' | 'wait' | 'blocked'; released?: boolean; dim: boolean; pulse: boolean }, 'work'>;

const NOOP = () => {};

const FIT = { padding: 0.08, maxZoom: 1, minZoom: 0.35 };

const EDGE_STYLE = {
  fork: { stroke: 'var(--muted)', dash: undefined, width: 1.5 },
  wait: { stroke: STATE_COLOR.think, dash: '6 5', width: 1.5 },
  blocked: { stroke: STATE_COLOR.stop, dash: '1 5', width: 2 },
} as const;

export function EntityWorkCanvas({ snapshot, events, live, onWorker, link, onLink, open, onReroute }: {
  snapshot: EntitySnapshot; events: EntityEvent[]; live: boolean; onWorker: OnWorker;
  /** Override how a message was routed: its own worker, or a fork of the worker it went to. */
  onReroute?(seq: number, how: 'separate' | 'fork'): void;
  /** Highlighted from the chat. */
  link?: WorkLink;
  onLink?(link: WorkLink): void;
  /** A request from the chat to open a worker; `n` changes with every request. */
  open?: { id: string; n: number } | null;
}) {
  const [openFolds, setOpenFolds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string[] | null>(null);
  const [sizes, setSizes] = React.useState<ReadonlyMap<string, { w: number; h: number }>>(() => new Map());
  // The snapshot's clock only moves when an event arrives; folding and durations need time to pass in quiet moments too.
  const t = useLiveClock(snapshot, live);
  const timed = React.useMemo(() => (t === snapshot.t ? snapshot : { ...snapshot, t }), [snapshot, t]);
  const pinned = React.useMemo(() => new Set([...expanded, ...(selected ? [selected] : []), ...(hovered ?? [])]), [expanded, selected, hovered]);
  const model = React.useMemo(() => deriveCanvas(timed, events, { openFolds, pinned }), [timed, events, openFolds, pinned]);
  const layout = React.useMemo(() => layoutCanvas(model, id => sizes.get(id)), [model, sizes]);
  const { pulsing, flashing } = usePulses(events, model, live);

  React.useEffect(() => { if (open) setSelected(open.id); }, [open]);
  // Hovering in the chat highlights here: a message shows the work it started or steered, a reply shows its worker.
  const linked = React.useMemo(() => {
    if (!link) return null;
    if (link.worker) return [link.worker];
    const ids = [...model.workers.values()].filter(w => w.replyTo === link.message).map(w => w.id);
    // Only a steer made for this message: before the user's next message.
    const next = events.find(e => e.type === 'chat_message' && e.by === 'user' && e.seq > link.message!);
    const steered = events.find(e => e.type === 'steered' && e.by !== 'user' && e.seq > link.message! && (!next || e.seq < next.seq));
    return ids.length ? ids : steered ? [String(steered.data.id)] : null;
  }, [link, model, events]);
  // Dimming what is unrelated is a lens you ask for: it applies only while Ctrl or ⌘ is held.
  const lens = useModifierHeld();
  const focus = React.useMemo(() => {
    if (!lens) return null;
    const ids = hovered ?? linked ?? (selected ? [selected] : null);
    if (!ids) return null;
    const nodes = new Set(ids.map(id => model.shownAs.get(id)).filter((n): n is string => !!n));
    for (const e of model.edges) { if (nodes.has(e.from)) nodes.add(e.to); else if (nodes.has(e.to)) nodes.add(e.from); }
    return nodes;
  }, [lens, hovered, linked, selected, model]);

  const at = React.useMemo(() => new Map(layout.placed.map(p => [p.id, p])), [layout]);
  const nodes = React.useMemo(() => buildNodes(model, at, sizes), [model, at, sizes]);
  const edges = React.useMemo<WorkEdge[]>(() => model.edges.flatMap(e => {
    const a = at.get(e.from), b = at.get(e.to);
    if (!a || !b) return [];
    const box = (id: string, p: { x: number; y: number }) => ({ ...p, w: sizes.get(id)?.w ?? CARD_W, h: sizes.get(id)?.h ?? 90 });
    return [{
      id: e.id, source: e.from, target: e.to, type: 'work' as const, sourceHandle: 'out', targetHandle: 'in',
      data: { path: edgePath(box(e.from, a), box(e.to, b)), kind: e.kind, released: e.released, dim: !!focus && !(focus.has(e.from) && focus.has(e.to)), pulse: pulsing.has(e.id) },
    }];
  }), [model, at, sizes, focus, pulsing]);

  const onNodesChange = React.useCallback((changes: NodeChange<WorkNode>[]) => {
    setSizes(prev => {
      let next: Map<string, { w: number; h: number }> | null = null;
      for (const change of changes) {
        if (change.type !== 'dimensions' || !change.dimensions) continue;
        const old = prev.get(change.id);
        const { width: w, height: h } = change.dimensions;
        if (old && Math.abs(old.w - w) < 0.5 && Math.abs(old.h - h) < 0.5) continue;
        next ??= new Map(prev);
        next.set(change.id, { w, h });
      }
      return next ?? prev;
    });
  }, []);

  // Work that folds away fades out where it was, and the rows below slide up, instead of vanishing and jumping.
  const ghosts = useGhosts(nodes, model);
  const shown = React.useMemo(() => (ghosts.length ? [...nodes, ...ghosts] : nodes), [nodes, ghosts]);

  const flow = React.useRef<ReactFlowInstance<WorkNode, WorkEdge> | null>(null);
  const fitted = React.useRef(false);
  const [settled, setSettled] = React.useState(false);
  // Until you pan or zoom yourself, the view keeps everything in sight as work is added or folds away.
  const userMoved = React.useRef(false);
  React.useEffect(() => {
    if (!fitted.current || userMoved.current) return;
    const timer = setTimeout(() => flow.current?.fitView({ ...FIT, duration: 250 }), 150);
    return () => clearTimeout(timer);
  }, [layout.height, layout.width]);
  React.useEffect(() => {
    // Fit once there is something to show and it has been measured.
    if (fitted.current || !nodes.length || sizes.size < nodes.length) return;
    fitted.current = true;
    requestAnimationFrame(() => { flow.current?.fitView(FIT); setTimeout(() => setSettled(true), 400); });
  }, [nodes.length, sizes.size]);

  const ctx: Ctx = {
    t, live, focus, selected, expanded, flashing,
    nameOf: id => model.workers.get(id)?.name ?? id,
    shownAs: id => model.shownAs.get(id),
    select: setSelected,
    hover: (ids, next) => { setHovered(ids); onLink?.(ids ? next ?? (ids.length === 1 ? { worker: ids[0] } : null) : null); },
    toggleExpanded: id => setExpanded(prev => toggled(prev, id)),
    toggleFold: key => setOpenFolds(prev => toggled(prev, key)),
    // A rename is the Hub's: every view, the chat and the entity's own state use it.
    rename: (id, name) => { if (live && name.trim()) onWorker(id, 'rename', name.trim()); },
    reroute: live ? onReroute : undefined,
  };
  const worker = selected ? model.workers.get(selected) : undefined;

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col" data-settled={settled || undefined}>
        <TopStrip model={model} t={t} onPick={setSelected} onFit={() => { userMoved.current = false; flow.current?.fitView({ ...FIT, duration: 200 }); }} />
        <div className="relative min-h-0 flex-1">
          {model.rows.length === 0 ? (
            <div className="p-4 text-[var(--muted)]">No work yet. Ask for something that takes real work and it shows up here.</div>
          ) : (
            <ReactFlow<WorkNode, WorkEdge>
              nodes={shown} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onInit={instance => { flow.current = instance; }}
              // Without a node handler xyflow turns off pointer events on nodes; the cards handle their own clicks.
              onNodeClick={NOOP}
              onMoveStart={event => { if (event) userMoved.current = true; }}
              fitView fitViewOptions={FIT}
              minZoom={0.2} maxZoom={1.6}
              nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesFocusable={false}
              zoomOnDoubleClick={false} panOnDrag preventScrolling
              onPaneClick={() => setSelected(null)}
              proOptions={{ hideAttribution: true }}
              aria-label="Work canvas. Drag to pan, scroll to zoom, select a card to open its thread."
            >
              <Background gap={18} size={2.2} color="rgba(231, 233, 239, 0.07)" />
              <Rules rules={layout.rules} width={layout.width} />
            </ReactFlow>
          )}
          {worker ? <Drawer w={worker} events={events} t={t} live={live} onWorker={onWorker} onClose={() => setSelected(null)} /> : null}
        </div>
      </div>
    </CanvasCtx.Provider>
  );
}

function buildNodes(model: CanvasModel, at: Map<string, { x: number; y: number }>, sizes: ReadonlyMap<string, { w: number; h: number }>): WorkNode[] {
  const nodes: WorkNode[] = [];
  const pos = (id: string) => at.get(id) ?? { x: 0, y: 0 };
  const measured = (id: string) => { const s = sizes.get(id); return s ? { measured: { width: s.w, height: s.h } } : {}; };
  const workRow = (row: WorkRow, nested: boolean) => {
    nodes.push({ id: lineId(row.key), type: 'line', position: pos(lineId(row.key)), data: { line: row.line, nested }, ...measured(lineId(row.key)) });
    for (const s of row.stacks) {
      if (s.kind === 'card') nodes.push({ id: cardId(s.id), type: 'card', position: pos(cardId(s.id)), data: { card: s }, ...measured(cardId(s.id)) });
      else if (s.kind === 'group') nodes.push({ id: groupId(s.id), type: 'batch', position: pos(groupId(s.id)), data: { group: s }, ...measured(groupId(s.id)) });
      else nodes.push({ id: moreId(s.id), type: 'more', position: pos(moreId(s.id)), data: { more: s }, ...measured(moreId(s.id)) });
    }
  };
  for (const row of model.rows) {
    if (row.kind === 'work') { workRow(row, false); continue; }
    if (row.kind === 'line') { nodes.push({ id: lineId(row.key), type: 'line', position: pos(lineId(row.key)), data: { line: row.line, nested: false }, ...measured(lineId(row.key)) }); continue; }
    nodes.push({ id: foldId(row.key), type: 'fold', position: pos(foldId(row.key)), data: { fold: row }, ...measured(foldId(row.key)) });
    if (!row.open) continue;
    for (const item of row.items) {
      if ('kind' in item) workRow(item, true);
      else nodes.push({ id: lineId(item.key), type: 'line', position: pos(lineId(item.key)), data: { line: item, nested: true }, ...measured(lineId(item.key)) });
    }
  }
  return nodes;
}

/** A curve from the right of one card to the left of the next column; a straight drop within a column. */
function edgePath(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): string {
  if (b.x >= a.x + a.w - 4) {
    const p = [a.x + a.w, a.y + Math.min(a.h / 2, 40)], q = [b.x, b.y + Math.min(b.h / 2, 40)];
    const dx = Math.max(30, (q[0] - p[0]) / 2);
    return `M${p[0]} ${p[1]} C${p[0] + dx} ${p[1]} ${q[0] - dx} ${q[1]} ${q[0]} ${q[1]}`;
  }
  const x = Math.max(a.x, b.x) + 40, down = b.y > a.y;
  return `M${x} ${down ? a.y + a.h : a.y} L${x} ${down ? b.y : b.y + b.h}`;
}

function WorkEdgeView({ data, id }: EdgeProps<WorkEdge>) {
  if (!data) return null;
  const style = EDGE_STYLE[data.kind];
  const stroke = data.released ? STATE_COLOR.done : style.stroke;
  return (
    <>
      <defs>
        <marker id={`arrow-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L8 4L0 8z" fill={stroke} />
        </marker>
      </defs>
      <BaseEdge path={data.path} markerEnd={`url(#arrow-${id})`}
        style={{ stroke, strokeWidth: style.width, strokeDasharray: data.released ? undefined : style.dash, strokeLinecap: 'round', opacity: data.dim ? 0.15 : data.released ? 0.5 : 1, transition: 'opacity .2s' }} />
      {data.pulse ? (
        <g style={{ color: stroke }} className="pointer-events-none">
          <path d={data.path} pathLength={100} fill="none" stroke="currentColor" strokeWidth={7} strokeLinecap="round" opacity={0.25} className="brain-comet" />
          <path d={data.path} pathLength={100} fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" className="brain-comet" />
        </g>
      ) : null}
    </>
  );
}

/** Faint rules between rows, drawn in flow coordinates so they pan and zoom with the nodes. */
function Rules({ rules, width }: { rules: number[]; width: number }) {
  return (
    <ViewportPortal>
      <svg width={1} height={1} className="pointer-events-none absolute left-0 top-0 overflow-visible" aria-hidden>
        {rules.map(y => <line key={y} x1={0} x2={width} y1={y} y2={y} stroke="var(--border)" strokeOpacity={0.6} />)}
      </svg>
    </ViewportPortal>
  );
}

const handles = (
  <>
    <Handle id="in" type="target" position={Position.Left} className="!pointer-events-none !opacity-0" isConnectable={false} />
    <Handle id="out" type="source" position={Position.Right} className="!pointer-events-none !opacity-0" isConnectable={false} />
  </>
);

function LineNode({ data }: NodeProps<Node<LineData, 'line'>>) {
  const { line, nested } = data;
  const ctx = useCtx();
  const target = line.target;
  const lit = !!ctx.focus && [...(line.workers ?? []), ...(target ? [target] : [])].some(id => ctx.focus!.has(cardId(id)) || ctx.focus!.has(ctx.shownAs(id) ?? ''));
  return (
    <div className={`group grid grid-cols-[40px_minmax(0,1fr)] gap-x-2 text-[12px] ${nested ? 'border-l-2 border-[var(--border)] pl-2.5' : ''} ${ctx.focus && !lit ? 'opacity-40' : ''}`}
      style={{ width: nested ? LINE_W - 12 : LINE_W }}
      onMouseEnter={() => { const ids = line.workers?.length ? line.workers : target ? [target] : []; ctx.hover(ids, line.seq !== undefined ? { message: line.seq } : null); }} onMouseLeave={() => ctx.hover(null)}>
      <span className="pt-px font-mono text-[11px] text-[var(--muted)] opacity-80" title={timeTitle(line.at, line.t)}>{timeOfDay(line.at, line.t)}</span>
      <span className="line-clamp-2 text-[var(--fg-secondary,var(--fg))]" title={line.text}>{line.by === 'user' ? line.text : <i>{line.text}</i>}</span>
      {ctx.reroute && line.by === 'user' && line.seq !== undefined && !line.workers?.length ? (
        // Routing is a guess; these make a wrong one cheap to fix. Shown on hover.
        <span className="col-start-2 hidden gap-1.5 text-[11px] group-hover:flex">
          <button type="button" className="rounded border border-[var(--border)] px-1.5 hover:bg-[var(--hover)]" title="Start a fresh worker for this message"
            onClick={() => ctx.reroute!(line.seq!, 'separate')}>Own worker</button>
          {line.target ? (
            <button type="button" className="rounded border border-[var(--border)] px-1.5 hover:bg-[var(--hover)]" title={`Start a worker that continues from ${ctx.nameOf(line.target)}'s conversation`}
              onClick={() => ctx.reroute!(line.seq!, 'fork')}>Fork of {ctx.nameOf(line.target)}</button>
          ) : null}
        </span>
      ) : null}
      {line.tag || line.replied ? (
        <span className="col-start-2 text-[11px] text-[var(--muted)]">
          {line.tag.startsWith('→') || line.tag.startsWith('steered') ? <span className="text-[var(--accent)]">{line.tag}</span> : line.tag}
          {line.replied ? <span style={{ color: STATE_COLOR.done }}> · ✓ replied</span> : null}
        </span>
      ) : null}
      {handles}
    </div>
  );
}

function FoldNode({ data }: NodeProps<Node<FoldData, 'fold'>>) {
  const { fold } = data;
  const ctx = useCtx();
  const parts = [
    fold.finished ? `${fold.finished} finished${fold.cost || fold.tokens ? ` · ${spend(fold.cost, fold.tokens)}` : ''}` : '',
    fold.messages ? `${fold.messages} message${fold.messages > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return (
    <button type="button" aria-expanded={fold.open} onClick={() => ctx.toggleFold(fold.key)}
      className="grid grid-cols-[40px_auto] gap-x-2 rounded px-0 py-px text-left text-[11.5px] text-[var(--muted)] hover:bg-[var(--hover)]" style={{ width: LINE_W }}>
      <span className="font-mono text-[11px] opacity-80" title={timeTitle(fold.at, fold.t)}>{timeOfDay(fold.at, fold.t)}</span>
      <span>{fold.open ? '⌃' : '···'} {parts.join(' · ')}{fold.steered.length ? <span className="text-[var(--accent)]"> · steered {fold.steered.join(', ')}</span> : null}</span>
      {handles}
    </button>
  );
}

function CardView({ data }: NodeProps<Node<CardData, 'card'>>) {
  const { card } = data;
  const w = card.item;
  const ctx = useCtx();
  const open = ctx.expanded.has(w.id);
  const dim = !!ctx.focus && !ctx.focus.has(cardId(w.id));
  const finished = w.state === 'done';
  return (
    <div role="button" tabIndex={0} aria-label={`${w.name}, ${w.label}`}
      onClick={() => ctx.select(ctx.selected === w.id ? null : w.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.select(w.id); } }}
      onMouseEnter={() => ctx.hover([w.id])} onMouseLeave={() => ctx.hover(null)}
      className={`relative grid cursor-pointer gap-1 rounded-[9px] border bg-[var(--panel)] py-2 pl-3.5 pr-2.5 work-card transition-[opacity,border-color] ${ctx.selected === w.id ? 'border-[var(--accent)]' : w.state === 'need' ? 'border-[color-mix(in_srgb,var(--orange,#e8773a)_55%,var(--border))]' : 'border-[var(--border)] hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]'} ${dim ? 'opacity-30' : finished ? 'opacity-80' : ''} ${ctx.flashing.has(w.id) ? 'entity-flash' : ''}`}
      style={{ width: CARD_W }}>
      <span className="absolute -left-px bottom-2.5 top-2.5 w-[3px] rounded-r" style={{ background: tone(w) }} />
      <div className="flex min-w-0 items-center gap-1.5">
        <Name id={w.id} name={w.name} />
        <span className="ml-auto shrink-0"><CardStatus w={w} t={ctx.t} /></span>
        <button type="button" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); ctx.toggleExpanded(w.id); }}
          className="shrink-0 rounded px-1 text-[12px] leading-none text-[var(--muted)] hover:bg-[var(--hover)]" style={{ transform: open ? 'rotate(180deg)' : undefined }}>⌄</button>
      </div>
      <div className={`min-w-0 text-[12px] text-[var(--fg-secondary,var(--fg))] ${open ? '' : 'line-clamp-2'}`} title={statusText(w, ctx.nameOf)}>
        {statusText(w, ctx.nameOf)}
      </div>
      {open ? (
        <div className="grid gap-1.5 border-t border-[var(--border)] pt-1.5 text-[12px]">
          <Steps w={w} />
          {card.chips.map(c => <div key={c.id} className="text-[var(--muted)]"><ChipIcon kind={c.kind} /> {c.detail}</div>)}
          {w.claims.length ? <div className="flex flex-wrap gap-1">{w.claims.map(c => <span key={c} className="rounded bg-[var(--panel-alt)] px-1 font-mono text-[11px]">{c}</span>)}</div> : null}
          {w.model ? <div className="font-mono text-[11px] text-[var(--muted)]">{w.model}</div> : null}
        </div>
      ) : null}
      {finished && !open ? null : (
        <div className="flex items-center gap-2.5 text-[var(--muted)]">
          <Pips w={w} />
          {card.chips.length ? <span className="flex gap-1">{card.chips.map(c => <ChipView key={c.id} chip={c} />)}</span> : null}
          <span className="ml-auto font-mono text-[11.5px] tabular-nums">{clock(w.durationMs)}</span>
          <span className="font-mono text-[11.5px] tabular-nums">{spend(w.cost, w.tokens)}</span>
        </div>
      )}
      {handles}
    </div>
  );
}

function Name({ id, name }: { id: string; name: string }) {
  const ctx = useCtx();
  const [editing, setEditing] = React.useState(false);
  if (editing) {
    return (
      <input autoFocus defaultValue={name} aria-label="Worker name" onClick={e => e.stopPropagation()}
        onBlur={e => { ctx.rename(id, e.currentTarget.value); setEditing(false); }}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
        className="nodrag min-w-0 flex-1 rounded border border-[var(--accent)] bg-[var(--hover)] px-1 text-[13px] font-semibold text-[var(--fg)] outline-none" />
    );
  }
  return <span className="min-w-0 truncate font-semibold" title={`${name} (${id}) · double-click to rename`} onDoubleClick={e => { e.stopPropagation(); setEditing(true); }}>{name}</span>;
}

function GroupView({ data }: NodeProps<Node<GroupData, 'batch'>>) {
  const { group } = data;
  const ctx = useCtx();
  const open = ctx.expanded.has(group.id);
  const [filter, setFilter] = React.useState<WorkItem['state'] | 'all'>('all');
  const count = (state: WorkItem['state']) => group.members.filter(w => w.state === state).length;
  const order: WorkItem['state'][] = ['act', 'think', 'wait', 'need', 'stop', 'done'];
  const label: Record<WorkItem['state'], string> = { act: 'working', think: 'thinking', wait: 'waiting', need: 'need you', stop: 'stopped', done: 'done' };
  const lead = order.find(s => s !== 'done' && count(s)) ?? 'done';
  const dim = !!ctx.focus && !ctx.focus.has(groupId(group.id));
  return (
    <div className={`relative grid gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--panel)] py-2 pl-3.5 pr-2.5 work-card ${dim ? 'opacity-30' : ''}`} style={{ width: CARD_W }}>
      <span className="absolute -left-px bottom-2.5 top-2.5 w-[3px] rounded-r" style={{ background: STATE_COLOR[lead] }} />
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-semibold" title={group.title}>{group.title}</span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">{group.members.length} workers</span>
        <button type="button" aria-expanded={open} aria-label={open ? 'Collapse group' : 'List the workers'} onClick={() => ctx.toggleExpanded(group.id)}
          className="ml-auto shrink-0 rounded px-1 text-[12px] leading-none text-[var(--muted)] hover:bg-[var(--hover)]" style={{ transform: open ? 'rotate(180deg)' : undefined }}>⌄</button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--fg-secondary,var(--fg))]">
        {order.filter(count).map(s => <span key={s} className="inline-flex items-center gap-1.5" style={{ color: STATE_COLOR[s] }}><Dot /><span className="text-[var(--fg-secondary,var(--fg))]">{count(s)} {label[s]}</span></span>)}
      </div>
      {open ? (
        <>
          <div className="flex flex-wrap gap-1 text-[11.5px]">
            {(['all', ...order.filter(count)] as const).map(f => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
                className={`rounded-full border border-[var(--border)] px-2 ${filter === f ? 'bg-[var(--hover)] text-[var(--fg)]' : 'text-[var(--muted)]'}`}>{f === 'all' ? 'All' : label[f]}</button>
            ))}
          </div>
          <div className="nowheel grid max-h-[260px] overflow-auto">
            {group.members.filter(w => filter === 'all' || w.state === filter).map(w => (
              <button key={w.id} type="button" onClick={() => ctx.select(w.id)}
                className={`grid grid-cols-[10px_minmax(0,10em)_minmax(0,1fr)] items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] hover:bg-[var(--hover)] ${ctx.selected === w.id ? 'bg-[var(--hover)]' : ''}`}>
                <span style={{ color: STATE_COLOR[w.state] }}><Dot /></span>
                <span className="truncate">{w.name}</span>
                <span className="truncate text-[var(--muted)]">{statusText(w, ctx.nameOf)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(20, minmax(0, 1fr))' }}>
          {group.members.map(w => (
            <button key={w.id} type="button" aria-label={`${w.name}: ${w.label}`} title={`${w.name} · ${w.label}\n${statusText(w, ctx.nameOf)}`}
              onClick={() => ctx.select(w.id)}
              className={`aspect-square rounded-[2px] p-0 ${ctx.selected === w.id ? 'outline outline-2 outline-offset-1 outline-[var(--fg)]' : 'hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-[var(--fg)]'}`}
              style={w.status === 'queued' ? { boxShadow: 'inset 0 0 0 1px var(--muted)' } : { background: STATE_COLOR[w.state], opacity: w.state === 'done' ? 0.45 : 0.85 }} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2.5 text-[var(--muted)]">
        <span className="text-[12px]">{count('done')}/{group.members.length} done</span>
        <span className="ml-auto font-mono text-[11.5px] tabular-nums">{clock(group.durationMs)}</span>
        <span className="font-mono text-[11.5px] tabular-nums">{spend(group.cost, group.tokens)}</span>
      </div>
      {handles}
    </div>
  );
}

/** Workers pulled out of a group beyond the first few cards: one line each. */
function MoreView({ data }: NodeProps<Node<MoreData, 'more'>>) {
  const { more } = data;
  const ctx = useCtx();
  const dim = !!ctx.focus && !ctx.focus.has(moreId(more.id));
  return (
    <div className={`grid gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 work-card ${dim ? 'opacity-30' : ''}`} style={{ width: CARD_W }}>
      <div className="px-1 text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]">{more.items.length} more need attention</div>
      <div className="nowheel grid max-h-[200px] overflow-auto">
        {more.items.map(w => (
          <button key={w.id} type="button" onClick={() => ctx.select(w.id)} onMouseEnter={() => ctx.hover([w.id])} onMouseLeave={() => ctx.hover(null)}
            className={`grid grid-cols-[10px_minmax(0,9em)_minmax(0,1fr)] items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] hover:bg-[var(--hover)] ${ctx.selected === w.id ? 'bg-[var(--hover)]' : ''}`}>
            <span style={{ color: STATE_COLOR[w.state] }}><Dot /></span>
            <span className="truncate">{ctx.nameOf(w.id)}</span>
            <span className="truncate text-[var(--muted)]">{statusText(w, ctx.nameOf)}</span>
          </button>
        ))}
      </div>
      {handles}
    </div>
  );
}

function ChipIcon({ kind }: { kind: Chip['kind'] }) {
  return kind === 'watch'
    ? <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.3} className="inline-block align-[-2px]" aria-hidden><path d="M1 6s1.8-3.3 5-3.3S11 6 11 6 9.2 9.3 6 9.3 1 6 1 6z" /><circle cx={6} cy={6} r={1.5} fill="currentColor" stroke="none" /></svg>
    : <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" className="inline-block align-[-2px]" aria-hidden><path d="M4 3.5 1.5 6 4 8.5M8 3.5 10.5 6 8 8.5" /></svg>;
}

function ChipView({ chip }: { chip: Chip }) {
  const color = chip.state === 'armed' ? STATE_COLOR.think : chip.state === 'running' ? STATE_COLOR.act : chip.state === 'failed' ? STATE_COLOR.stop : STATE_COLOR.done;
  return (
    <span title={`${chip.kind} · ${chip.label}\n${chip.detail}`} className="inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full border px-1.5 font-mono text-[11px]"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, var(--border))` }}>
      <ChipIcon kind={chip.kind} />{chip.value}
    </span>
  );
}

function TopStrip({ model, t, onPick, onFit }: { model: CanvasModel; t: number; onPick(id: string): void; onFit(): void }) {
  const color = { need: STATE_COLOR.need, wait: STATE_COLOR.wait, queued: 'var(--muted)' } as const;
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border)] px-3 py-1 text-[12px]" aria-label="Needs you and coming up">
      {model.attention.map(a => (
        <button key={`${a.kind}:${a.id}`} type="button" onClick={() => onPick(a.id)}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] px-2 py-px hover:bg-[var(--hover)]" style={{ color: color[a.kind] }}>
          <Dot /><span className="text-[var(--fg-secondary,var(--fg))]">{a.text}</span>
        </button>
      ))}
      {model.entityChips.length ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-[var(--muted)]" title="Watches and programs the entity itself runs">
          entity {model.entityChips.map(c => <ChipView key={c.id} chip={c} />)}
        </span>
      ) : null}
      {!model.attention.length && !model.entityChips.length ? <span className="text-[var(--muted)]">Nothing needs you.</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-3 font-mono text-[12px] text-[var(--muted)]">
        {model.head ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 font-sans" style={{ color: STATE_COLOR.think }} title={`Head is thinking: ${model.head.reason}`}>
            <Dot pulse /><span className="text-[var(--fg-secondary,var(--fg))]">head</span>
            <span className="max-w-[26ch] truncate text-[var(--muted)]">{model.head.reason}</span>
            <span className="font-mono text-[11px] text-[var(--muted)]">{clock(t - model.head.since)}</span>
          </span>
        ) : null}
        <span title="Session time">{clock(t)}</span>
        <span title={model.usageDetail}>{spend(model.costTotal, model.tokensTotal)}</span>
      </span>
      <button type="button" onClick={onFit} className="shrink-0 rounded border border-[var(--border)] px-2 text-[var(--muted)] hover:bg-[var(--hover)]">Fit</button>
    </div>
  );
}

function Drawer({ w, events, t, live, onWorker, onClose }: { w: WorkItem; events: EntityEvent[]; t: number; live: boolean; onWorker: OnWorker; onClose(): void }) {
  const ctx = useCtx();
  // The worker's thread: the message that started it and the task it was given, then what it said and what it was told.
  const thread = events.filter(e => (e.type === 'chat_message' && e.by === w.id) || (e.type === 'steered' && e.data.id === w.id));
  const origin = w.replyTo !== undefined ? events.find(e => e.seq === w.replyTo) : undefined;
  const started = events.find(e => e.type === 'limb_spawned' && e.data.id === w.id);
  return (
    <aside className="absolute inset-y-0 right-0 z-10 grid w-[360px] max-w-full grid-rows-[auto_minmax(0,1fr)] border-l border-[var(--border)] bg-[var(--panel)] shadow-lg" aria-label={`${w.name} details`}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="min-w-0 truncate font-semibold" title={w.id}>{w.name}</span>
        <CardStatus w={w} t={t} />
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto rounded px-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">✕</button>
      </div>
      <div className="grid content-start gap-2 overflow-y-auto">
        <WorkerDetail w={w} live={live} onWorker={onWorker} />
        <div className="grid gap-2 px-3 pb-3">
          {origin ? (
            <div className="max-w-[88%] justify-self-end rounded-[9px] bg-[color-mix(in_srgb,var(--accent)_14%,var(--panel))] px-2.5 py-1.5">
              <div className="text-[11px] text-[var(--muted)]" title={timeTitle(origin.at, origin.t, w.createdAt)}>you · {timeOfDay(origin.at, origin.t)}</div>
              <MarkdownMessage text={String(origin.data.text ?? '')} className="dh-markdown--agent entity-md" />
            </div>
          ) : null}
          {w.task ? (
            <details className="text-[12px] text-[var(--muted)]">
              <summary className="cursor-pointer" title={started ? timeTitle(started.at, started.t, w.createdAt) : undefined}>Task given{started ? ` by ${started.by}` : ''} · {started ? timeOfDay(started.at, started.t) : ''}</summary>
              <div className="mt-1 whitespace-pre-wrap text-[var(--fg-secondary,var(--fg))]">{w.task}</div>
            </details>
          ) : null}
          {thread.map(e => (
            <div key={e.seq} className={`max-w-[88%] rounded-[9px] px-2.5 py-1.5 ${e.type === 'steered' ? 'justify-self-end bg-[color-mix(in_srgb,var(--accent)_14%,var(--panel))]' : 'bg-[var(--panel-alt)]'}`}>
              <div className="text-[11px] text-[var(--muted)]" title={timeTitle(e.at, e.t, w.createdAt)}>{e.type === 'steered' ? (e.by === 'user' ? 'you' : `you, via ${e.by}`) : ctx.nameOf(w.id)} · {timeOfDay(e.at, e.t)}</div>
              <MarkdownMessage text={String(e.data.text ?? '')} className="dh-markdown--agent entity-md" />
            </div>
          ))}
          {!thread.length && !origin ? <div className="text-[12px] text-[var(--muted)]">Nothing said yet.</div> : null}
        </div>
      </div>
    </aside>
  );
}

/**
 * What a card says the worker is doing: its current step from the summary, or what it was asked to do. Never the tool it
 * happens to be calling (that changes every second, and external agents don't report it).
 */
function statusText(w: WorkItem, nameOf: (id: string) => string): string {
  if (w.waitFor && w.status === 'waiting') return `Starts when ${nameOf(w.waitFor)} finishes`;
  if (w.state === 'done' || w.state === 'stop') return w.result ?? w.label;
  if (w.steps?.doing[0]) return w.steps.doing[0];
  if (w.label === 'blocked' && w.now?.object) return `Blocked: ${w.now.object}`;
  if (w.status === 'queued') return `Queued: ${firstLine(w.task ?? w.name)}`;
  if (w.task) return firstLine(w.task);
  return w.label === 'idle' ? 'Not started' : 'Working';
}

/** Arrows and cards that just changed: a comet along a fork or a released wait, a flash on a card. */
function usePulses(events: EntityEvent[], model: CanvasModel, live: boolean) {
  const [pulsing, setPulsing] = React.useState<ReadonlySet<string>>(() => new Set());
  const [flashing, setFlashing] = React.useState<ReadonlySet<string>>(() => new Set());
  const last = React.useRef<number | null>(null);
  React.useEffect(() => {
    const newest = events[events.length - 1]?.seq ?? 0;
    const from = last.current;
    last.current = newest;
    if (!live || from === null || newest <= from) return;
    const edges = new Set<string>();
    const cards = new Set<string>();
    for (const e of events) {
      if (e.seq <= from) continue;
      const id = String(e.data.id ?? '');
      if (e.type === 'task_done') {
        cards.add(e.by);
        for (const edge of model.edges) if (edge.kind !== 'fork' && edge.from === model.shownAs.get(e.by)) edges.add(edge.id);
      }
      if (e.type === 'limb_spawned' && e.data.fork_of) for (const edge of model.edges) if (edge.kind === 'fork' && edge.to === model.shownAs.get(id)) edges.add(edge.id);
      if (e.type === 'limb_started' || e.type === 'steered' || e.type === 'limb_revived') cards.add(id);
    }
    if (!edges.size && !cards.size) return;
    setPulsing(prev => new Set([...prev, ...edges]));
    setFlashing(prev => new Set([...prev, ...cards]));
    const timer = setTimeout(() => {
      setPulsing(prev => new Set([...prev].filter(id => !edges.has(id))));
      setFlashing(prev => new Set([...prev].filter(id => !cards.has(id))));
    }, 900);
    return () => clearTimeout(timer);
  }, [events, model, live]);
  return { pulsing, flashing };
}

/** The entity clock, advanced locally between snapshots while the session runs (every 5 s is enough for folding). */
function useLiveClock(snapshot: EntitySnapshot, live: boolean): number {
  const base = React.useRef({ t: snapshot.t, at: performance.now() });
  if (base.current.t !== snapshot.t) base.current = { t: snapshot.t, at: performance.now() };
  const [, tick] = React.useState(0);
  const running = live && snapshot.status === 'running';
  React.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(timer);
  }, [running]);
  return running ? snapshot.t + (performance.now() - base.current.at) : snapshot.t;
}

/** Cards and groups that just folded away, kept a moment longer as fading copies where they were. */
function useGhosts(nodes: WorkNode[], model: CanvasModel): WorkNode[] {
  const previous = React.useRef<WorkNode[]>([]);
  const [ghosts, setGhosts] = React.useState<WorkNode[]>([]);
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>());
  React.useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  React.useEffect(() => {
    const ids = new Set(nodes.map(n => n.id));
    const folded = (n: WorkNode) => {
      const workers = n.type === 'card' ? [n.data.card.id] : n.type === 'batch' ? n.data.group.members.map(w => w.id) : [];
      return workers.some(id => model.shownAs.get(id)?.startsWith('fold:'));
    };
    const leaving = previous.current.filter(n => !ids.has(n.id) && !n.id.startsWith('ghost:') && folded(n))
      .map(n => ({ ...n, id: `ghost:${n.id}`, className: 'entity-leaving', selectable: false, focusable: false }) as WorkNode);
    previous.current = nodes;
    if (!leaving.length) return;
    setGhosts(prev => [...prev, ...leaving]);
    // Not cleared when nodes change again: live sessions change them constantly, and every ghost must leave.
    const timer = setTimeout(() => { timers.current.delete(timer); setGhosts(prev => prev.filter(g => !leaving.includes(g))); }, 400);
    timers.current.add(timer);
  }, [nodes, model]);
  return ghosts;
}


/** The time of day of an event (HH:MM), falling back to session time when there is no wall clock. */
const timeOfDay = (at: number | undefined, t: number) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : clock(t));
/** Hover text: the full time of day, and how far into the session (and the worker) it was. */
const timeTitle = (at: number | undefined, t: number, workerStart?: number) =>
  `${at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : ''} · ${clock(t)} into the session${workerStart !== undefined && t >= workerStart ? ` · ${clock(t - workerStart)} into this worker` : ''}`;

/** True while Ctrl or ⌘ is held. */
function useModifierHeld(): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    const update = (e: KeyboardEvent) => setHeld(e.ctrlKey || e.metaKey);
    const off = () => setHeld(false);
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('keydown', update); window.removeEventListener('keyup', update); window.removeEventListener('blur', off); };
  }, []);
  return held;
}

const firstLine = (text: string) => { const line = text.split('\n')[0].trim(); return line.length > 140 ? `${line.slice(0, 139)}…` : line; };

/** The card's state: calm words and how long it has been at it, not the tool it is calling. */
function CardStatus({ w }: { w: WorkItem; t: number }) {
  const busy = w.state === 'act' || w.state === 'think';
  const label = busy ? 'working' : w.label === 'idle' ? 'idle' : w.label.startsWith('after ') ? 'waiting' : w.label;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: tone(w) }}>
      <Dot pulse={busy} />{label}
    </span>
  );
}

/** Thinking and acting are both just "working" on the canvas, in one colour. */
const tone = (w: WorkItem) => STATE_COLOR[w.state === 'think' ? 'act' : w.state];

const toggled = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); return next; };

// Not "group": xyflow styles nodes of that type as its own group containers.
const nodeTypes = { line: LineNode, card: CardView, batch: GroupView, fold: FoldNode, more: MoreView };
const edgeTypes = { work: WorkEdgeView };
