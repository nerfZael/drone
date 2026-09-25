import type { Caller, EntityEvent, EventMatcher, Level, RiskClass, Schema } from './types.js';

/** Levels: values that hold over time. Channels derive them from events; `sense` writes fuzzy ones. */
export class Levels {
  private readonly values = new Map<string, Level>();
  constructor(private readonly now: () => number) {}

  set(name: string, value: unknown, by?: string, since = this.now()): void {
    const current = this.values.get(name);
    if (current && current.value === value) return;
    this.values.set(name, { value, since, by });
  }
  clear(name: string): void { this.values.delete(name); }
  get(name: string): Level | undefined { return this.values.get(name); }
  entries(): [string, Level][] { return [...this.values.entries()]; }
}

export interface EffectContext<W = unknown> {
  caller: Caller;
  world: W;
  /** Appends an event attributed to the caller. */
  emit(type: string, data: Record<string, unknown>): EntityEvent;
  now(): number;
  /** Full log access, for read-only effects such as `read_chat`. */
  events(): readonly EntityEvent[];
}

export interface EffectSpec<A = any, W = any> {
  name: string;
  description: string;
  parameters: Schema;
  risk: RiskClass;
  /** Output effects are blocked by output stops. Default true. */
  output?: boolean;
  /** Voice effects obey "the newest voice run owns the voice". Default false. */
  voice?: boolean;
  /** Read-only effects append nothing to the log and are never blocked. */
  readonly?: boolean;
  /** Events that, if they happened after the caller's read, make this effect stale. */
  dependsOn?(args: A): EventMatcher[];
  /** Workspace paths this effect writes. Writing claims them; a path claimed by another limb is refused. */
  paths?(args: A): string[];
  /** The parameter a program may pass positionally, e.g. `say("hi")`. */
  shorthand?: string;
  apply(args: A, ctx: EffectContext<W>): string | Promise<string>;
}

export interface RenderContext {
  now: number;
  /** Formats an age, e.g. "4.2s ago". */
  ago(t: number): string;
  levels: Levels;
}

export interface Rendered {
  /** Slow-changing part, rendered early for prompt caching. */
  stable?: unknown;
  /** Fast-changing part, rendered in the volatile tail. */
  volatile?: unknown;
}

/** A channel is a host module: its slice of the world, its senses and its effects. */
export interface Channel<W = any> {
  name: string;
  /** Short description for the system prompt. */
  describe: string;
  init(): W;
  reduce(world: W, event: EntityEvent, ctx: { levels: Levels; now: number }): void;
  effects: EffectSpec<any, W>[];
  render(world: W, ctx: RenderContext): Rendered;
  /** Event types the host (UI) may inject, attributed to the user. */
  inputs: string[];
  /** Adds derived fields to an event's data before it is logged, e.g. how long a key was held. */
  enrich?(world: W, type: string, data: Record<string, unknown>, now: number): Record<string, unknown>;
}
