import type { ModelUsage } from './mind.js';

/**
 * What the user asked for, split from their messages: something to do, a question, or a standing rule. The entity
 * tracks asks beside the work, so a view can show what was asked, what took it, and whether it was resolved.
 * The agents carry none of this: a host model splits messages and judges resolutions. See entity/docs/asks.md.
 */
export type AskKind = 'do' | 'question' | 'rule';

export interface Ask {
  id: string;
  kind: AskKind;
  text: string;
  /** The user messages that asked it: the first, then every repeat. */
  seqs: number[];
  /** When it was first asked (entity clock). */
  t: number;
  /** Open until resolved; asked again after that, it is open again and keeps its last resolution. Rules stay open. */
  status: 'open' | 'resolved' | 'replaced';
  resolved?: { by: string; t: number; note?: string };
  replacedBy?: string;
  /** The workers it went to: linked when they were started or steered for it. */
  workers: string[];
}

export interface AskView { id: string; kind: AskKind; text: string }

/** Splits messages into asks and judges which asks a result or reply resolved. The Hub backs it with a cheap model. */
export interface AskTracker {
  /**
   * The asks in one user message. `repeats`: earlier asks (by id) this message asks again; `replaces`: earlier asks it
   * overrides (a rule or request the user changed their mind about). A message with nothing to track gives nothing.
   */
  split(input: { message: string; earlier: AskView[] }, signal: AbortSignal): Promise<{ asks: { kind: AskKind; text: string }[]; repeats?: string[]; replaces?: string[]; usage?: ModelUsage }>;
  /** Which of these asks the evidence (a finished worker's result, or a reply) resolves, each with an optional short note. */
  resolve(input: { asks: (AskView & { said: string[] })[]; by: string; evidence: string }, signal: AbortSignal): Promise<{ resolved: { id: string; note?: string }[]; usage?: ModelUsage }>;
  /**
   * Which of these asks a new piece of work serves, when the run that started it read several messages. Optional:
   * without it the work is linked to all of them.
   */
  link?(input: { asks: (AskView & { said: string[] })[]; name: string; task: string }, signal: AbortSignal): Promise<{ ids: string[]; usage?: ModelUsage }>;
}

const KINDS: readonly AskKind[] = ['do', 'question', 'rule'];
export const isAskKind = (value: unknown): value is AskKind => KINDS.includes(value as AskKind);
