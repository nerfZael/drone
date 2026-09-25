// Shared types for the entity runtime. See entity/docs/core-model.md.

/** Who caused an event: the user, the host, the runtime itself, or a limb id. */
export type Actor = 'user' | 'host' | 'system' | (string & {});

export interface EntityEvent<T = Record<string, unknown>> {
  seq: number;
  /** Milliseconds since the session started. */
  t: number;
  /** Wall-clock epoch milliseconds. */
  at: number;
  type: string;
  by: Actor;
  data: T;
}

/** A value that holds over time, with a known start. */
export interface Level {
  value: unknown;
  since: number;
  by?: Actor;
}

export type RiskClass = 'reflex' | 'limb' | 'confirm';

/** A minimal JSON-schema subset, enough to describe and validate tool arguments. */
export type Schema =
  | { type: 'string'; description?: string; enum?: string[]; maxLength?: number }
  | { type: 'number' | 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: Schema; maxItems?: number }
  | { type: 'object'; description?: string; properties: Record<string, Schema>; required?: string[]; additionalProperties?: boolean }
  | { description?: string; anyOf: Schema[] };

/** Matches events for dependency checks and program waits. */
export interface EventMatcher {
  type?: string | string[];
  by?: Actor | Actor[];
  /** Every listed data field must equal the given value. */
  data?: Record<string, unknown>;
}

export type LimbKind = 'llm' | 'code';

export type Capability = 'speak' | 'set_watch' | 'run_program' | 'cancel' | 'kill';

/** Who is committing an effect. */
export interface Caller {
  limbId: string;
  kind: LimbKind;
  /** LLM run id, when the caller is an LLM limb run. */
  runId?: string;
  /** Log position the caller's projection was built from. */
  readSeq: number;
}
