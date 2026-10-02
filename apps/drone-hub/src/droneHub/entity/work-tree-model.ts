import type { EntityEvent, EntitySnapshot } from '@entity/core';
import type { WorkItem } from './EntityWork';

type Ask = NonNullable<EntitySnapshot['asks']>[number];
type Limb = EntitySnapshot['limbs'][number];

/**
 * One thing the user asked for, or one thing the entity started on its own, with the agents doing it. The Work tab
 * lists these in time order; see entity/docs/work-canvas.md. Pure: everything comes from the snapshot and the log.
 */
export interface WorkRequest {
  key: string;
  /** When it began (entity clock), and the wall clock then. */
  t: number;
  at?: number;
  title: string;
  /** The user's own words, when a message started it. */
  words?: string;
  /** Started by the entity, not by a user message; `why` is the reason it gave. */
  self: boolean;
  why?: string;
  /** The asks of the message that started it, with their status. */
  asks: Ask[];
  /** Its agents in stages: each sits below the agents it waits for (`deps`, within this request). */
  stages: string[][];
  deps: Record<string, string[]>;
  /** For an agent that waits on a whole batch, the batch's title. */
  waitsOnBatch: Record<string, string>;
  workers: WorkItem[];
  /** What it produced, when it is finished and one agent's result stands for it (one agent, or the one the rest led to). */
  outcome?: WorkItem;
  status: 'running' | 'done' | 'stopped';
  ended?: number;
  cost: number;
  tokens: number;
}

export interface WorkTree {
  requests: WorkRequest[];
  running: WorkRequest[];
  /** How long a stretch of the session really ran: time paused (and down, before a restore) is left out. */
  ran(from: number, to: number): number;
  /** Things to do the user asked for that no agent took and nobody answered: work the entity may have dropped. */
  untaken: Ask[];
}

const ACTIVE = new Set(['running', 'queued', 'waiting']);
/** An open ask is called untaken only once the entity has had time to act on it. */
export const UNTAKEN_AFTER_MS = 30_000;

export function deriveTree(snapshot: EntitySnapshot, events: EntityEvent[], work: WorkItem[]): WorkTree {
  const limbs = new Map(snapshot.limbs.map(l => [l.id, l]));
  const items = new Map(work.map(w => [w.id, w]));
  const asks = snapshot.asks ?? [];
  const workers = snapshot.limbs.filter(l => l.role === 'task').sort((a, b) => a.createdAt - b.createdAt);
  const messages = new Map(events.filter(e => e.type === 'chat_message' && e.by === 'user').map(e => [e.seq, e]));
  const batches = new Map(events.filter(e => e.type === 'group_started').map(e => [String(e.data.id), String(e.data.title ?? '')]));

  // Which request each agent belongs to: the message of an ask it serves, else the message it was started for, else its own.
  const originOf = (l: Limb): string => {
    // Work that waits on a whole batch belongs with that batch.
    const batchOrigin = l.afterGroup ? workers.find(w => w.group === l.afterGroup) : undefined;
    if (batchOrigin && batchOrigin.id !== l.id) return originOf(batchOrigin);
    const served = asks.filter(a => a.workers.includes(l.id)).map(a => a.seqs[0]).sort((a, b) => a - b)[0];
    if (served !== undefined) return `msg:${served}`;
    if (l.cause && l.cause.kind !== 'user') return `self:${l.group ?? l.id}`;
    const seq = l.cause?.seqs?.length ? (l.replyTo !== undefined && l.cause.seqs.includes(l.replyTo) ? l.replyTo : l.cause.seqs[l.cause.seqs.length - 1]) : l.replyTo;
    return seq !== undefined ? `msg:${seq}` : `self:${l.group ?? l.id}`;
  };
  // A batch stays together, in the request of its first agent.
  const groupOrigin = new Map<string, string>();
  const origin = new Map<string, string>();
  for (const l of workers) {
    const key = l.group && groupOrigin.has(l.group) ? groupOrigin.get(l.group)! : originOf(l);
    if (l.group && !groupOrigin.has(l.group)) groupOrigin.set(l.group, key);
    origin.set(l.id, key);
  }

  const keys = [...new Set(workers.map(l => origin.get(l.id)!))];
  const requests = keys.map((key): WorkRequest => {
    const members = workers.filter(l => origin.get(l.id) === key);
    const own = members.map(l => items.get(l.id)).filter((w): w is WorkItem => !!w);
    const seq = key.startsWith('msg:') ? Number(key.slice(4)) : undefined;
    const message = seq !== undefined ? messages.get(seq) : undefined;
    const ids = new Set(members.map(l => l.id));
    const deps = Object.fromEntries(members.map(l => [l.id, dependencies(l, workers).filter(d => ids.has(d))]));
    const stages = stagesOf(members, deps);
    const active = members.some(l => ACTIVE.has(l.status));
    const status = active ? 'running' : members.some(l => l.status === 'done') ? 'done' : 'stopped';
    const groups = [...new Set(members.map(l => l.group).filter((g): g is string => !!g))];
    const first = members[0];
    const requestAsks = seq !== undefined ? asks.filter(a => a.seqs[0] === seq) : [];
    const title = groups.length === 1 && members.every(l => l.group === groups[0]) ? batches.get(groups[0]) || first.name
      : members.length === 1 ? first.name
        : requestAsks.find(a => a.kind !== 'rule')?.text ?? clip(String(message?.data.text ?? first.name), 60);
    return {
      key, t: message?.t ?? first.createdAt, at: message?.at, title,
      words: message ? String(message.data.text ?? '') : undefined,
      self: key.startsWith('self:'), why: key.startsWith('self:') ? first.why : undefined,
      asks: requestAsks, stages, deps, workers: own,
      waitsOnBatch: Object.fromEntries(members.filter(l => l.afterGroup).map(l => [l.id, batches.get(l.afterGroup!) || l.afterGroup!])),
      outcome: status === 'done' ? outcomeOf(members, deps, items) : undefined,
      status, ended: active ? undefined : Math.max(...members.map(l => l.endedAt ?? l.createdAt)),
      cost: own.reduce((sum, w) => sum + w.cost, 0), tokens: own.reduce((sum, w) => sum + w.tokens, 0),
    };
  }).sort((a, b) => a.t - b.t);

  const taken = new Set(requests.flatMap(r => r.asks.map(a => a.id)));
  const pauses = pausesOf(events, snapshot.t);
  const untaken = asks.filter(a => a.kind === 'do' && a.status === 'open' && !a.workers.length && !taken.has(a.id) && snapshot.t - a.t > UNTAKEN_AFTER_MS);
  const ran = (from: number, to: number) => Math.max(0, to - from - pauses.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0));
  return { requests, running: requests.filter(r => r.status === 'running'), untaken, ran };
}

/** The stretches the session was paused, from the log: a pause lasts until it is resumed, or until now. */
export function pausesOf(events: EntityEvent[], now: number): [number, number][] {
  const out: [number, number][] = [];
  let since: number | undefined;
  for (const e of events) {
    // The Hub was down before a restore: that time did not run either.
    if (e.type === 'session_restored' && since === undefined && typeof e.data.downtime_ms === 'number') out.push([e.t - e.data.downtime_ms, e.t]);
    if (e.type === 'session_paused' && since === undefined) since = e.t;
    if (e.type === 'session_resumed' && since !== undefined) { out.push([since, e.t]); since = undefined; }
  }
  if (since !== undefined) out.push([since, now]);
  return out;
}

/** What an agent waits for: the agents it names, and every agent of the batch it waits on. */
function dependencies(l: Limb, workers: Limb[]): string[] {
  const named = l.afterAll ?? (l.after && !l.afterGroup ? [l.after] : []);
  const batch = l.afterGroup ? workers.filter(w => w.group === l.afterGroup && w.id !== l.id).map(w => w.id) : [];
  return [...new Set([...named, ...batch])];
}

/** Agents in stages: each one stage below the deepest agent it waits for. */
function stagesOf(members: Limb[], deps: Record<string, string[]>): string[][] {
  const depth = new Map<string, number>();
  const d = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    const before = (deps[id] ?? []).filter(x => !seen.has(x));
    const value = before.length ? Math.max(...before.map(x => d(x, new Set([...seen, id])))) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  const rows: string[][] = [];
  for (const l of members) (rows[d(l.id, new Set([l.id]))] ??= []).push(l.id);
  return rows.filter(Boolean);
}

/** The agent whose result stands for a finished request: the only one, or the one every other agent led to. */
function outcomeOf(members: Limb[], deps: Record<string, string[]>, items: Map<string, WorkItem>): WorkItem | undefined {
  if (members.length === 1) return items.get(members[0].id);
  const waitedOn = new Set(Object.values(deps).flat());
  const sinks = members.filter(l => !waitedOn.has(l.id) && deps[l.id]?.length);
  return sinks.length === 1 && sinks[0].status === 'done' ? items.get(sinks[0].id) : undefined;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
