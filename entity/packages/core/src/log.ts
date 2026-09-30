import type { Actor, EntityEvent, EventMatcher } from './types.js';

type Listener = (event: EntityEvent) => void;

/** Append-only event log: the only source of truth. */
export class EventLog {
  private readonly events: EntityEvent[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(private readonly clock: () => number, private readonly started = Date.now()) {}

  append<T extends Record<string, unknown>>(type: string, by: Actor, data: T): EntityEvent<T> {
    const t = this.clock();
    const event: EntityEvent<T> = { seq: this.events.length + 1, t, at: this.started + t, type, by, data };
    this.events.push(event as EntityEvent);
    for (const listener of [...this.listeners]) listener(event as EntityEvent);
    return event;
  }

  /** Puts back an event from an earlier run of this session (restore), without notifying anyone. */
  load(event: EntityEvent): void {
    if (event.seq !== this.events.length + 1) throw new Error(`restore: expected event #${this.events.length + 1}, got #${event.seq}`);
    this.events.push(event);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get length(): number { return this.events.length; }
  all(): readonly EntityEvent[] { return this.events; }
  since(seq: number): EntityEvent[] { return this.events.slice(seq); }
  last(n: number): EntityEvent[] { return this.events.slice(-n); }
}

export function matches(event: EntityEvent, matcher: EventMatcher): boolean {
  if (matcher.type !== undefined) {
    const types = Array.isArray(matcher.type) ? matcher.type : [matcher.type];
    if (!types.includes(event.type)) return false;
  }
  if (matcher.by !== undefined) {
    const actors = Array.isArray(matcher.by) ? matcher.by : [matcher.by];
    if (!actors.includes(event.by)) return false;
  }
  if (matcher.data) {
    for (const [key, value] of Object.entries(matcher.data)) if (event.data[key] !== value) return false;
  }
  return true;
}

export const isEntityActor = (by: Actor) => by !== 'user' && by !== 'host' && by !== 'system';
