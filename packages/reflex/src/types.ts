/** Typed questions a System One evaluator (Jev) answers over one shared state. */
export type ReflexQuestion =
  | { type: 'boolean'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type ReflexAnswer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> };

export type ReflexAnswers = Record<string, ReflexAnswer>;

/** Leaf conditions read one answer. `is` compares a choice option or 'true'/'false'; `atLeast`/`atMost` bound a probability or score. */
export type ReflexLeafCondition =
  | { question: string; is: string; minProbability?: number }
  | { question: string; atLeast: number }
  | { question: string; atMost: number };

export type ReflexCondition =
  | ReflexLeafCondition
  | { all: ReflexCondition[] }
  | { any: ReflexCondition[] }
  | { not: ReflexCondition };

/** Rules are matched in order; the first satisfied rule acts. A rule without a condition always matches. */
export type ReflexRule = {
  id: string;
  when: ReflexCondition | null;
  /** Action name registered in code by the host. Never free text. */
  do: string;
  args?: Record<string, unknown>;
  /** When set, firing this rule also wakes the brain with this reason. */
  wake?: string;
  description?: string;
};

/** A boolean question the brain expects to hold. P(true) below the threshold wakes the brain. */
export type ReflexExpectation = {
  instructions: string;
  criteria?: { true?: string; false?: string };
  threshold: number;
};

export type ReflexWakePolicy = {
  /** Decision confidence below this counts as a low-confidence tick. */
  minConfidence: number;
  /** Consecutive low-confidence ticks before waking. */
  lowConfidenceTicks: number;
  /** Minimum time between wakes. */
  cooldownMs: number;
  /** Wake once the table is older than this, when set. */
  maxTableAgeMs?: number;
};

export type ReflexTableSource = 'default' | 'brain' | 'user';

export type ReflexTable = {
  id: string;
  version: number;
  source: ReflexTableSource;
  createdAt: number;
  /** Prepended to every question's instructions, typically a description of the state fields. */
  preamble?: string;
  questions: Record<string, ReflexQuestion>;
  expectations?: Record<string, ReflexExpectation>;
  /** Facts computed in code per tick (name → description). Rules read them as boolean or score answers named `fact:<name>`. */
  facts?: Record<string, string>;
  rules: ReflexRule[];
  wake: ReflexWakePolicy;
  /** The brain's rationale for its latest revision. */
  notes?: string;
};

export type ReflexTick<S = unknown> = {
  id: string;
  startedAt: number;
  durationMs: number;
  tableVersion: number;
  state: S;
  serialized: unknown;
  questions: Record<string, ReflexQuestion>;
  answers?: ReflexAnswers;
  rule?: string;
  action?: string;
  confidence?: number;
  wake?: string;
  /** The state changed in a way that invalidated this decision before it could act. */
  stale?: boolean;
  error?: string;
};

export type ReflexEvaluate = (
  state: unknown,
  questions: Record<string, ReflexQuestion>,
  signal: AbortSignal,
) => Promise<ReflexAnswers>;
