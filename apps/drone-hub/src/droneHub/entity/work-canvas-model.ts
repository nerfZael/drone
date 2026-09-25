import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { deriveWork, type WorkItem, type WorkerState } from './EntityWork';

/**
 * The Work canvas as data: rows in time order (one per origin of work), lineage columns, group cards for
 * fan-outs, folds for everything that needs no attention, and the arrows between work. Pure, so it can be
 * derived again on every event and tested without a DOM. See entity/docs/work-canvas.md.
 */

/** A fan-out of this many workers from one origin becomes one group card. */
export const GROUP_MIN = 4;
/** Finished work folds away this long after it finished, so it does not vanish the moment it is done. */
export const FOLD_AFTER_MS = 60_000;
/** The most recently finished rows and plain messages that always stay out of folds, so you can see what was just done. */
export const KEEP_FINISHED = 5;
export const KEEP_MESSAGES = 3;
/** States that keep a worker visible as its own card, inside a group or not. */
const ATTENTION = new Set<WorkerState>(['need', 'stop']);

type Limb = EntitySnapshot['limbs'][number];

export interface Chip {
  id: string;
  kind: 'watch' | 'program';
  label: string;
  state: 'armed' | 'running' | 'done' | 'failed';
  /** One short value: how often a watch fired, how long a program has run. */
  value: string;
  /** The full description, for the hover card. */
  detail: string;
}

export interface CardNode { kind: 'card'; id: string; col: number; item: WorkItem; chips: Chip[] }

/** Workers pulled out of a group past the first few: one compact list instead of a card each. */
export interface MoreNode { kind: 'more'; id: string; col: number; items: WorkItem[] }

export type Stack = CardNode | GroupNode | MoreNode;

/** Pulled-out workers shown as full cards under their group before the rest become a list. */
export const PULLED_OUT_CARDS = 3;

export interface GroupNode {
  kind: 'group';
  id: string;
  col: number;
  title: string;
  members: WorkItem[];
  cost: number;
  tokens: number;
  durationMs: number;
}

export interface OriginLine {
  key: string;
  t: number;
  /** Wall-clock time (ms), for showing the time of day. */
  at?: number;
  text: string;
  /** 'user', or the limb that started work on its own. */
  by: string;
  /** What came of it: "→ task-3 · fork of task-1", "answered", "steered task-3". */
  tag: string;
  /** The worker a steer or direct message went to, for highlighting. */
  target?: string;
  replied?: boolean;
  /** The chat message this line is, for linking to the chat. */
  seq?: number;
  /** The workers this line started. */
  workers?: string[];
}

export interface WorkRow { kind: 'work'; key: string; t: number; line: OriginLine; stacks: Stack[] }

export interface FoldRow {
  kind: 'fold';
  key: string;
  t: number;
  at?: number;
  open: boolean;
  items: (OriginLine | WorkRow)[];
  finished: number;
  messages: number;
  cost: number;
  tokens: number;
  steered: string[];
}

/** A recent message that started no work of its own, not folded yet. */
export interface LineRow { kind: 'line'; key: string; t: number; line: OriginLine }

export type CanvasRow = WorkRow | FoldRow | LineRow;

export interface CanvasEdge { id: string; from: string; to: string; kind: 'fork' | 'wait' | 'blocked'; released?: boolean }

export interface Attention { id: string; kind: 'need' | 'wait' | 'queued'; text: string }

export interface CanvasModel {
  rows: CanvasRow[];
  /** Worker id → the node that shows it: its card, its group, or the fold it is in. */
  shownAs: Map<string, string>;
  edges: CanvasEdge[];
  /** Watches and programs of the head and voice: they belong to no worker. */
  entityChips: Chip[];
  attention: Attention[];
  workers: Map<string, WorkItem>;
}

export interface CanvasUi {
  openFolds: ReadonlySet<string>;
  /** Selected, expanded or hovered workers: they never fold away while looked at. */
  pinned: ReadonlySet<string>;
  /** Overrides for KEEP_FINISHED and KEEP_MESSAGES. */
  keepFinished?: number;
  keepMessages?: number;
}

export const cardId = (id: string) => `card:${id}`;
export const groupId = (id: string) => `group:${id}`;
export const foldId = (key: string) => `fold:${key}`;
export const lineId = (key: string) => `line:${key}`;
export const moreId = (id: string) => `more:${id}`;
export const stackId = (s: Stack) => (s.kind === 'card' ? cardId(s.id) : s.kind === 'group' ? groupId(s.id) : moreId(s.id));

export function deriveCanvas(snapshot: EntitySnapshot, events: EntityEvent[], ui: CanvasUi): CanvasModel {
  const { workers: items } = deriveWork(snapshot, events);
  const workers = new Map(items.map(w => [w.id, w]));
  const limbs = new Map(snapshot.limbs.map(l => [l.id, l]));
  const spawned = new Map<string, EntityEvent>();
  const groupTitles = new Map<string, string>();
  const userMessages: EntityEvent[] = [];
  const steers: EntityEvent[] = [];
  const entityReplies: EntityEvent[] = [];
  const replied = new Set<number>();
  for (const e of events) {
    if (e.type === 'limb_spawned') spawned.set(String(e.data.id), e);
    else if (e.type === 'group_started') groupTitles.set(String(e.data.id), String(e.data.title));
    else if (e.type === 'chat_message' && e.by === 'user') userMessages.push(e);
    else if (e.type === 'chat_message') {
      entityReplies.push(e);
      if (typeof e.data.reply_to === 'number' && workers.has(e.by)) replied.add(e.data.reply_to);
    } else if (e.type === 'steered') steers.push(e);
  }
  const name = (id: string) => workers.get(id)?.name ?? id;

  // Lineage columns: a fork sits right of its source, gated work right of what it waits for.
  const col = new Map<string, number>();
  for (const w of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    const spawn = spawned.get(w.id);
    const from = spawn?.data.fork_of ? String(spawn.data.fork_of) : spawn?.data.after ? String(spawn.data.after) : undefined;
    col.set(w.id, from && col.has(from) ? col.get(from)! + 1 : 0);
  }

  // Arrows between work. Their ends are mapped to whatever shows each worker once rows and folds are known.
  const rawEdges: CanvasEdge[] = [];
  for (const w of items) {
    const spawn = spawned.get(w.id);
    if (spawn?.data.fork_of && workers.has(String(spawn.data.fork_of))) rawEdges.push({ id: `fork:${w.id}`, from: String(spawn.data.fork_of), to: w.id, kind: 'fork' });
    if (spawn?.data.after && workers.has(String(spawn.data.after))) {
      const target = workers.get(String(spawn.data.after))!;
      rawEdges.push({ id: `wait:${w.id}`, from: target.id, to: w.id, kind: 'wait', released: target.endedAt !== undefined });
    }
    const holder = w.label === 'blocked' ? w.blockedBy : undefined;
    if (holder && workers.has(holder)) rawEdges.push({ id: `blocked:${w.id}`, from: holder, to: w.id, kind: 'blocked' });
  }
  const isLive = (id: string) => { const w = workers.get(id); return !!w && w.state !== 'done'; };
  const hasLiveNeighbour = (id: string) => rawEdges.some(e => !(e.kind === 'wait' && e.released) && ((e.from === id && isLive(e.to)) || (e.to === id && isLive(e.from))));

  // Work rows: one per origin. Workers answer a user message, or were started by a limb on its own.
  const byOrigin = new Map<string, WorkItem[]>();
  for (const w of items) {
    const key = w.replyTo !== undefined ? `m${w.replyTo}` : `s${w.id}`;
    const list = byOrigin.get(key);
    if (list) list.push(w); else byOrigin.set(key, [w]);
  }
  const chipsFor = (owner: string) => snapshot.limbs.filter(l => l.parent === owner && (l.role === 'watch' || l.role === 'program')).map(l => chip(l, snapshot.t));

  const lines: { line: OriginLine; row?: WorkRow; foldable: boolean }[] = [];
  const messageAt = (seq: number) => userMessages.find(m => m.seq === seq);
  for (const [key, list] of byOrigin) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    const message = key.startsWith('m') ? messageAt(Number(key.slice(1))) : undefined;
    const first = list[0];
    const spawn = spawned.get(first.id);
    const how = spawn?.data.fork_of ? ` · fork of ${name(String(spawn.data.fork_of))}` : spawn?.data.after ? ` · after ${name(String(spawn.data.after))}` : '';
    const group = first.group ? groupTitles.get(first.group) : undefined;
    const line: OriginLine = {
      key, t: message?.t ?? first.createdAt, at: message?.at ?? spawn?.at, by: message ? 'user' : String(spawn?.by ?? 'head'),
      text: message ? String(message.data.text) : `${String(spawn?.by ?? 'head')} started: ${String(limbs.get(first.id)?.task ?? first.name)}`,
      tag: list.length > 1 ? `→ ${list.length} workers${group ? ` · ${group}` : ''}` : `→ ${first.name}${how}`,
      replied: message ? replied.has(message.seq) : undefined,
      seq: message?.seq, workers: list.map(w => w.id),
    };
    const row: WorkRow = { kind: 'work', key, t: line.t, line, stacks: stacksFor(list, col, groupTitles, chipsFor, message) };
    const done = list.every(w => w.state === 'done' && w.endedAt !== undefined && snapshot.t - w.endedAt >= FOLD_AFTER_MS);
    const foldable = done && !list.some(w => ui.pinned.has(w.id) || hasLiveNeighbour(w.id));
    lines.push({ line, row, foldable });
  }
  // Messages that started no work: a steer, a question the front limb answered, a message in a worker's thread.
  const workKeys = new Set(byOrigin.keys());
  userMessages.forEach((m, i) => {
    if (workKeys.has(`m${m.seq}`)) return;
    const until = userMessages[i + 1]?.t ?? Infinity;
    const steer = steers.find(s => s.by !== 'user' && s.t >= m.t && s.t < until);
    const answered = entityReplies.some(r => r.t >= m.t && r.t < until);
    const target = steer ? String(steer.data.id) : undefined;
    // Like finished work, a message folds a minute after it was sent: time enough to see where it went and correct it.
    lines.push({ line: { key: `m${m.seq}`, t: m.t, at: m.at, by: 'user', text: String(m.data.text), tag: target ? `steered ${name(target)}` : answered ? 'answered in chat' : '', target, seq: m.seq }, foldable: snapshot.t - m.t >= FOLD_AFTER_MS && !(target && ui.pinned.has(target)) });
  });
  for (const s of steers) {
    if (s.by !== 'user') continue;
    const target = String(s.data.id);
    lines.push({ line: { key: `d${s.seq}`, t: s.t, at: s.at, by: 'user', text: String(s.data.text), tag: `in ${name(target)}'s thread`, target }, foldable: snapshot.t - s.t >= FOLD_AFTER_MS });
  }
  lines.sort((a, b) => a.line.t - b.line.t || (a.line.key < b.line.key ? -1 : 1));
  // Only older work folds: the latest finished rows and the latest plain messages stay in view.
  const ended = (row: WorkRow) => Math.max(...row.stacks.flatMap(s => (s.kind === 'card' ? [s.item] : s.kind === 'group' ? s.members : [])).map(w => w.endedAt ?? 0));
  const keep = new Set([
    ...lines.filter(l => l.row && l.foldable).sort((a, b) => ended(b.row!) - ended(a.row!)).slice(0, ui.keepFinished ?? KEEP_FINISHED),
    ...((ui.keepMessages ?? KEEP_MESSAGES) > 0 ? lines.filter(l => !l.row && l.foldable).slice(-(ui.keepMessages ?? KEEP_MESSAGES)) : []),
  ]);
  for (const l of keep) l.foldable = false;

  // Runs of foldable lines become one fold between the rows that stay.
  const rows: CanvasRow[] = [];
  let fold: FoldRow | undefined;
  for (const { line, row, foldable } of lines) {
    if (!foldable) { fold = undefined; rows.push(row ?? { kind: 'line', key: line.key, t: line.t, line }); continue; }
    if (!fold) {
      fold = { kind: 'fold', key: line.key, t: line.t, at: line.at, open: ui.openFolds.has(line.key), items: [], finished: 0, messages: 0, cost: 0, tokens: 0, steered: [] };
      rows.push(fold);
    }
    if (row) {
      fold.items.push(row);
      for (const s of row.stacks) for (const w of s.kind === 'card' ? [s.item] : s.kind === 'group' ? s.members : []) { fold.finished++; fold.cost += w.cost; fold.tokens += w.tokens; }
    } else {
      fold.items.push(line);
      fold.messages++;
      if (line.target && line.tag.startsWith('steered') && !fold.steered.includes(name(line.target))) fold.steered.push(name(line.target));
    }
  }

  // What shows each worker: its card, its group, or its closed fold.
  const shownAs = new Map<string, string>();
  const place = (row: WorkRow, closedFold?: string) => {
    for (const s of row.stacks) {
      if (s.kind === 'card') shownAs.set(s.id, closedFold ?? cardId(s.id));
      else if (s.kind === 'group') for (const w of s.members) shownAs.set(w.id, closedFold ?? groupId(s.id));
      else for (const w of s.items) shownAs.set(w.id, closedFold ?? moreId(s.id));
    }
  };
  for (const row of rows) {
    if (row.kind === 'work') place(row);
    else if (row.kind === 'fold') for (const item of row.items) if ('kind' in item) place(item, row.open ? undefined : foldId(row.key));
  }
  const edges: CanvasEdge[] = [];
  const seen = new Set<string>();
  for (const e of rawEdges) {
    const from = shownAs.get(e.from), to = shownAs.get(e.to);
    if (!from || !to || from === to) continue;
    const id = `${e.kind}:${from}>${to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ ...e, id, from, to });
  }

  const attention: Attention[] = [];
  for (const w of items) if (w.state === 'need') attention.push({ id: w.id, kind: 'need', text: `${w.name}: ${w.label}` });
  for (const w of items) if (w.waitFor && w.status === 'waiting') attention.push({ id: w.id, kind: 'wait', text: `${w.name} starts after ${name(w.waitFor)}` });
  const queued = items.filter(w => w.status === 'queued');
  if (queued.length) attention.push({ id: queued[0].id, kind: 'queued', text: `${queued.length} queued` });

  const entityChips = snapshot.limbs.filter(l => (l.parent === 'head' || l.parent === 'voice') && (l.role === 'watch' || l.role === 'program') && l.status === 'running').map(l => chip(l, snapshot.t));
  return { rows, shownAs, edges, entityChips, attention, workers };
}

function stacksFor(list: WorkItem[], col: Map<string, number>, groupTitles: Map<string, string>, chipsFor: (owner: string) => Chip[], message: EntityEvent | undefined): Stack[] {
  const card = (w: WorkItem): CardNode => ({ kind: 'card', id: w.id, col: col.get(w.id) ?? 0, item: w, chips: chipsFor(w.id) });
  const stacks: Stack[] = [];
  // A batch (dispatch_many), or four or more plain workers from one message, is one group card.
  const batches = new Map<string, WorkItem[]>();
  for (const w of list) {
    const key = w.group ?? ((col.get(w.id) ?? 0) === 0 ? 'auto' : undefined);
    if (!key) continue;
    const members = batches.get(key);
    if (members) members.push(w); else batches.set(key, [w]);
  }
  const grouped = new Set<string>();
  for (const [key, members] of batches) {
    if (members.length < GROUP_MIN) continue;
    const id = key === 'auto' ? `auto-${members[0].id}` : key;
    stacks.push({
      kind: 'group', id, col: col.get(members[0].id) ?? 0,
      title: key === 'auto' ? clip(String(message?.data.text ?? members[0].name), 60) : groupTitles.get(key) ?? key,
      members,
      cost: members.reduce((sum, w) => sum + w.cost, 0),
      tokens: members.reduce((sum, w) => sum + w.tokens, 0),
      durationMs: Math.max(...members.map(w => w.durationMs)),
    });
    for (const w of members) grouped.add(w.id);
    // Workers that need attention also get their own card, right under their group; past a few, a compact list.
    const out = members.filter(w => ATTENTION.has(w.state));
    for (const w of out.slice(0, PULLED_OUT_CARDS)) stacks.push(card(w));
    if (out.length > PULLED_OUT_CARDS) stacks.push({ kind: 'more', id, col: col.get(members[0].id) ?? 0, items: out.slice(PULLED_OUT_CARDS) });
  }
  for (const w of list) if (!grouped.has(w.id)) stacks.push(card(w));
  return stacks;
}

function chip(l: Limb, now: number): Chip {
  const kind = l.role === 'watch' ? 'watch' : 'program';
  const state: Chip['state'] = l.status === 'running' ? (kind === 'watch' ? 'armed' : 'running') : l.status === 'failed' ? 'failed' : 'done';
  const secs = Math.round(((l.endedAt ?? now) - l.createdAt) / 1000);
  const value = kind === 'watch' ? (l.fires ? `${l.fires}×` : 'armed') : state === 'running' ? `${secs}s` : state === 'failed' ? 'failed' : '✓';
  const detail = kind === 'watch' && l.watch
    ? `${l.name}: on ${JSON.stringify(l.watch.on)}${l.watch.when ? ` when ${JSON.stringify(l.watch.when)}` : ''}, fired ${l.fires ?? 0}×`
    : `${l.name}${l.status === 'running' ? `, running for ${secs}s` : `, ${l.status}`}`;
  return { id: l.id, kind, label: clip(l.label ?? l.name, 28), state, value, detail };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ---------- layout ----------

export const LINE_W = 236;
export const CARD_W = 288;
const COL_X0 = 268;
const COL_GAP = 48;
const ROW_GAP = 18;
const STACK_GAP = 8;
const SMALL_GAP = 6;
const DEFAULT_SIZE: Record<string, number> = { line: 36, card: 92, group: 150, fold: 20, more: 80 };

export interface Placed { id: string; x: number; y: number }
export interface CanvasLayout { placed: Placed[]; rules: number[]; width: number; height: number }

/**
 * Places every visible node. Rows stack down in time order; each is as tall as its origin line or its tallest
 * column of cards. Sizes come from measuring the rendered nodes; unmeasured nodes get a default until they are.
 */
export function layoutCanvas(model: CanvasModel, size: (id: string) => { w: number; h: number } | undefined): CanvasLayout {
  const placed: Placed[] = [];
  const rules: number[] = [];
  const h = (id: string, kind: string) => size(id)?.h ?? DEFAULT_SIZE[kind];
  let y = 0;
  let maxCol = 0;
  const workRow = (row: WorkRow, first: boolean) => {
    if (!first) rules.push(y - ROW_GAP / 2);
    placed.push({ id: lineId(row.key), x: 0, y });
    const heights = new Map<number, number>();
    for (const s of row.stacks) {
      const id = stackId(s);
      const top = y + (heights.get(s.col) ?? 0);
      placed.push({ id, x: COL_X0 + s.col * (CARD_W + COL_GAP), y: top });
      heights.set(s.col, (heights.get(s.col) ?? 0) + h(id, s.kind) + STACK_GAP);
      maxCol = Math.max(maxCol, s.col);
    }
    y += Math.max(h(lineId(row.key), 'line'), ...[...heights.values()].map(v => v - STACK_GAP)) + ROW_GAP;
  };
  model.rows.forEach((row, i) => {
    if (row.kind === 'work') { workRow(row, i === 0); return; }
    if (row.kind === 'line') { placed.push({ id: lineId(row.key), x: 0, y }); y += h(lineId(row.key), 'line') + SMALL_GAP; return; }
    placed.push({ id: foldId(row.key), x: 0, y });
    y += h(foldId(row.key), 'fold') + SMALL_GAP;
    if (!row.open) return;
    for (const item of row.items) {
      if ('kind' in item) workRow(item, false);
      else { placed.push({ id: lineId(item.key), x: 12, y }); y += h(lineId(item.key), 'line') + SMALL_GAP; }
    }
  });
  return { placed, rules, width: COL_X0 + (maxCol + 1) * (CARD_W + COL_GAP), height: y };
}
