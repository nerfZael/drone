import type { Levels } from './channel.js';
import type { EntityEvent, Schema } from './types.js';

/** What starts a watch: an event edge, or a level (or sensed level) becoming true for long enough. */
export type WatchTrigger =
  | { event: string; key?: string; by?: 'user' | 'entity' | 'any'; data?: Record<string, unknown> }
  | { level: string; above?: number; below?: number; equals?: unknown; present?: boolean; for_ms?: number; by?: 'user' | 'entity' | 'any' }
  | { sense: string; above?: number; below?: number; for_ms?: number };

export type WatchAction =
  | { effect: string; args?: Record<string, unknown> }
  | { stop_output: { reason: string; scope?: StopScope; mode?: StopMode } }
  | { resume_output: Record<string, never> }
  | { wake: { reason: string } }
  | { run_program: { name: string; code: string; label?: string } };

/** work: everything under the installing limb except that limb itself. subtree: including it. entity: everything. */
export type StopScope = 'work' | 'subtree' | 'entity';
/** stop: cancel programs and reject actions. freeze: pause them at their next action until resumed. */
export type StopMode = 'stop' | 'freeze';

/** Extra conditions a watch checks when its trigger fires (and, for level and sense triggers, continuously). */
export type WatchCondition =
  | { level: string; above?: number; below?: number; equals?: unknown; present?: boolean; by?: 'user' | 'entity' | 'any' }
  | { sense: string; above?: number; below?: number }
  /** No event of this type (by default the user's) for at least for_ms, e.g. "the user stopped typing". */
  | { quiet: string | string[]; for_ms: number; by?: 'user' | 'entity' | 'any' }
  | { all: WatchCondition[] }
  | { any: WatchCondition[] }
  | { not: WatchCondition };

export interface WatchSpec {
  name: string;
  /** A few words saying what it does, for views with little room ("tests on quiet"). */
  label?: string;
  on: WatchTrigger;
  when?: WatchCondition;
  do: WatchAction;
  /** Remove the watch after it fires once. */
  once?: boolean;
  /** Remove the watch after this many seconds. */
  expires_s?: number;
}

const triggerSchema: Schema = {
  description: 'What starts the watch',
  anyOf: [
    {
      type: 'object', additionalProperties: false, required: ['event'],
      properties: {
        event: { type: 'string', description: 'Event type, e.g. key_down, key_up, chat_message, draft_changed' },
        key: { type: 'string', description: 'Only this key (keypad events)' },
        by: { type: 'string', enum: ['user', 'entity', 'any'], description: 'Whose events. Default "user": watches ignore your own events unless you ask.' },
        data: { type: 'object', properties: {}, description: 'Other event fields that must match exactly' },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['level'],
      properties: {
        level: { type: 'string', description: 'Level name, e.g. key.5.held, user.typing' },
        above: { type: 'number' }, below: { type: 'number' },
        equals: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        present: { type: 'boolean', description: 'true: fires when the level exists (default); false: when it does not' },
        by: { type: 'string', enum: ['user', 'entity', 'any'], description: 'Whose level (e.g. who holds the key). Default "user".' },
        for_ms: { type: 'integer', minimum: 0, maximum: 3_600_000, description: 'The condition must hold this long before firing' },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['sense'],
      properties: {
        sense: { type: 'string', maxLength: 500, description: 'A yes/no question about the conversation, answered continuously with a probability' },
        above: { type: 'number', minimum: 0, maximum: 1 }, below: { type: 'number', minimum: 0, maximum: 1 },
        for_ms: { type: 'integer', minimum: 0, maximum: 3_600_000 },
      },
    },
  ],
};

const actionSchema: Schema = {
  description: 'What the watch does when it fires',
  anyOf: [
    {
      type: 'object', additionalProperties: false, required: ['effect'],
      properties: {
        effect: { type: 'string', description: 'Effect name, e.g. press, key_down, key_up, say' },
        args: { type: 'object', properties: {}, description: 'Effect arguments. A string value "$key" (or "$<field>") is replaced by that field of the triggering event.' },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['stop_output'],
      properties: {
        stop_output: {
          type: 'object', additionalProperties: false, required: ['reason'],
          properties: {
            reason: { type: 'string', maxLength: 200 },
            scope: { type: 'string', enum: ['work', 'subtree', 'entity'], description: 'work (default): your programs, watches and task limbs, but not you. subtree: also your own output. entity: all entity output.' },
            mode: { type: 'string', enum: ['stop', 'freeze'], description: 'stop (default): cancel programs and reject actions. freeze: pause programs and task limbs at their next action until resume_output; nothing is lost.' },
          },
        },
      },
    },
    { type: 'object', additionalProperties: false, required: ['resume_output'], properties: { resume_output: { type: 'object', properties: {} } } },
    {
      type: 'object', additionalProperties: false, required: ['wake'],
      properties: { wake: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', maxLength: 200 } } } },
    },
    {
      type: 'object', additionalProperties: false, required: ['run_program'],
      properties: {
        run_program: {
          type: 'object', additionalProperties: false, required: ['name', 'code'],
          properties: { name: { type: 'string', maxLength: 80 }, label: { type: 'string', maxLength: 40 }, code: { type: 'string', maxLength: 20_000 } },
        },
      },
    },
  ],
};

function conditionSchema(depth: number): Schema {
  const leaves: Schema[] = [
    {
      type: 'object', additionalProperties: false, required: ['level'],
      properties: {
        level: { type: 'string' }, above: { type: 'number' }, below: { type: 'number' },
        equals: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] }, present: { type: 'boolean' },
        by: { type: 'string', enum: ['user', 'entity', 'any'] },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['sense'],
      properties: { sense: { type: 'string', maxLength: 500 }, above: { type: 'number', minimum: 0, maximum: 1 }, below: { type: 'number', minimum: 0, maximum: 1 } },
    },
    {
      type: 'object', additionalProperties: false, required: ['quiet', 'for_ms'],
      properties: {
        quiet: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 10 }], description: 'Event type(s) that must not have happened recently' },
        for_ms: { type: 'integer', minimum: 0, maximum: 3_600_000 },
        by: { type: 'string', enum: ['user', 'entity', 'any'], description: 'Whose events count. Default "user".' },
      },
    },
  ];
  if (depth <= 0) return { anyOf: leaves };
  const inner = conditionSchema(depth - 1);
  return {
    description: 'A condition: a level, a sense, a quiet period (e.g. {"quiet": "draft_changed", "for_ms": 700} = the user stopped typing), or all / any / not of conditions',
    anyOf: [
      ...leaves,
      { type: 'object', additionalProperties: false, required: ['all'], properties: { all: { type: 'array', items: inner, maxItems: 8 } } },
      { type: 'object', additionalProperties: false, required: ['any'], properties: { any: { type: 'array', items: inner, maxItems: 8 } } },
      { type: 'object', additionalProperties: false, required: ['not'], properties: { not: inner } },
    ],
  };
}

export const watchSchema: Schema = {
  type: 'object', additionalProperties: false, required: ['name', 'on', 'do'],
  properties: {
    name: { type: 'string', maxLength: 80, description: 'Short name shown in the inspector' },
    label: { type: 'string', maxLength: 40, description: 'A few words saying what it does, e.g. "tests on quiet"' },
    on: triggerSchema,
    when: conditionSchema(2),
    do: actionSchema,
    once: { type: 'boolean' },
    expires_s: { type: 'integer', minimum: 1, maximum: 86_400 },
  },
};

/** Tracks whether a level trigger has been true long enough, and fires once per true period. */
export class LevelTracker {
  private trueSince: number | null = null;
  private fired = false;

  /** Returns true when the watch should fire now. */
  update(holds: boolean, now: number, forMs: number): boolean {
    if (!holds) { this.trueSince = null; this.fired = false; return false; }
    this.trueSince ??= now;
    if (this.fired || now - this.trueSince < forMs) return false;
    this.fired = true;
    return true;
  }
}

export function levelHolds(trigger: Extract<WatchTrigger, { level: string }>, levels: Levels, isEntity: (by: string) => boolean): boolean {
  const level = levels.get(trigger.level);
  if (trigger.present === false) return level === undefined;
  if (!level) return false;
  const by = trigger.by ?? 'user';
  if (level.by !== undefined && by !== 'any' && (by === 'user' ? level.by !== 'user' : !isEntity(level.by))) return false;
  if (trigger.equals !== undefined) return level.value === trigger.equals;
  if (typeof level.value === 'number') {
    if (trigger.above !== undefined && !(level.value > trigger.above)) return false;
    if (trigger.below !== undefined && !(level.value < trigger.below)) return false;
  }
  return true;
}

export interface ConditionContext {
  levels: Levels;
  now: number;
  isEntity(by: string): boolean;
  senseValue(question: string): number | undefined;
  /** When the latest event of this type happened, by whom. */
  lastEvent(type: string, by: 'user' | 'entity' | 'any'): number | undefined;
}

export function conditionHolds(condition: WatchCondition, ctx: ConditionContext): boolean {
  if ('all' in condition) return condition.all.every(c => conditionHolds(c, ctx));
  if ('any' in condition) return condition.any.some(c => conditionHolds(c, ctx));
  if ('not' in condition) return !conditionHolds(condition.not, ctx);
  if ('level' in condition) return levelHolds(condition, ctx.levels, ctx.isEntity);
  if ('sense' in condition) return senseHolds(ctx.senseValue(condition.sense), condition);
  const types = Array.isArray(condition.quiet) ? condition.quiet : [condition.quiet];
  return types.every(type => {
    const last = ctx.lastEvent(type, condition.by ?? 'user');
    return last === undefined || ctx.now - last >= condition.for_ms;
  });
}

/** Every sense question a condition asks, so the runtime can keep them fresh. */
export function conditionSenses(condition: WatchCondition | undefined): string[] {
  if (!condition) return [];
  if ('all' in condition) return condition.all.flatMap(conditionSenses);
  if ('any' in condition) return condition.any.flatMap(conditionSenses);
  if ('not' in condition) return conditionSenses(condition.not);
  return 'sense' in condition ? [condition.sense] : [];
}

export function senseHolds(value: number | undefined, trigger: { above?: number; below?: number }): boolean {
  if (value === undefined) return false;
  if (trigger.below !== undefined) return value < trigger.below;
  return value > (trigger.above ?? 0.5);
}

export function eventMatchesTrigger(event: EntityEvent, trigger: Extract<WatchTrigger, { event: string }>, isEntity: (by: string) => boolean): boolean {
  if (event.type !== trigger.event) return false;
  const by = trigger.by ?? 'user';
  if (by === 'user' && event.by !== 'user') return false;
  if (by === 'entity' && !isEntity(event.by)) return false;
  if (trigger.key !== undefined && String(event.data.key) !== trigger.key) return false;
  for (const [field, value] of Object.entries(trigger.data ?? {})) if (event.data[field] !== value) return false;
  return true;
}

/** Replaces "$field" string values with the triggering event's data (or "$by"). */
export function templateArgs(args: Record<string, unknown> | undefined, event: EntityEvent | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (typeof value === 'string' && value.startsWith('$') && event) {
      const field = value.slice(1);
      result[key] = field === 'by' ? event.by : event.data[field] !== undefined ? String(event.data[field]) : value;
    } else result[key] = value;
  }
  return result;
}
