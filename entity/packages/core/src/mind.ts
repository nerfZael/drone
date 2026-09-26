/**
 * What model calls used. `input` excludes cached tokens; output includes reasoning. `cost` is in USD at list price
 * (also for subscription models), or null when the model has no known price.
 */
export interface ModelUsage { input: number; output: number; cacheRead?: number; cacheWrite?: number; cost?: number | null }

/** A tool as offered to a model. `parameters` is plain JSON schema. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface MindRunInput {
  limbId: string;
  runId: string;
  role: 'head' | 'voice' | 'task';
  /** Model id, e.g. "openai-codex/gpt-6-luna". */
  model: string;
  system: string;
  /** The rendered context for this wake: state, new events, time. */
  prompt: string;
  tools: ToolSpec[];
  /** Commits a tool call through the effect gate. Always resolves with text for the model. */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  signal: AbortSignal;
  /**
   * True once the limb has ended its turn with a tool (finish_task, ask): the mind should stop after the current
   * step and return normally, with its usage, rather than ask the model for another step.
   */
  ended?(): boolean;
  /**
   * Set for task limbs: the mind should keep conversation history under this key across runs,
   * until {@link Mind.forget} is called. Reactive runs have no key and start fresh.
   */
  sessionKey?: string;
  /** Most model turns (tool round trips) in this run. */
  maxSteps: number;
}

export interface MindRunResult {
  /** Why the run ended: the model stopped by itself, or it used all maxSteps turns while still working. */
  stopReason?: 'done' | 'max_steps';
  /** Final assistant text, if any. The user never sees it unless the limb calls `say`. */
  text?: string;
  usage?: ModelUsage;
}

/** Runs one LLM limb wake. The Hub implements it with a real model; tests use a scripted one. */
export interface Mind {
  run(input: MindRunInput): Promise<MindRunResult>;
  forget?(sessionKey: string): void;
  /** Clones a kept conversation, so a new limb can continue from where another one is. */
  fork?(fromKey: string, toKey: string): boolean;
}
