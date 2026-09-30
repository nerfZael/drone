import { describeToolArgs, type WorkSummary } from '@entity/core';
import type { AgentRunActivity } from '@drone/assistant-chat';
import type { ChatStepsSettings } from '../hub-settings';
import type { HubGenerationAttribution } from '../usage/trackHubGeneration';

/** A chat's latest turn in a few short steps, for the canvas's detailed cards. */
export type ChatSteps = WorkSummary & {
  droneId: string;
  chatName: string;
  turnId: string;
  updatedAt: string;
  /** Written after the turn ended: what it did, not where it was. */
  final: boolean;
};

export type ChatTurnActivity = { turnId: string; prompt: string; activity: AgentRunActivity | null | undefined };

export type ChatStepTrackerDeps = {
  settings: () => Promise<ChatStepsSettings>;
  runningChats: () => Array<{ droneId: string; chatName: string; chatId: string | null }>;
  /** The turn a running chat is working on. */
  readRunningTurn: (droneId: string, chatName: string) => ChatTurnActivity | null;
  /** The chat's latest finished turn. */
  readLastTurn: (droneId: string, chatName: string) => ChatTurnActivity | null;
  summarize: (opts: {
    modelRef: string;
    reasoning: string;
    input: { task: string; activity: string };
    signal: AbortSignal;
    attribution: HubGenerationAttribution;
  }) => Promise<WorkSummary>;
  /** Saved summaries, read once, and each new one written back. */
  load?: () => ChatSteps[];
  save?: (steps: ChatSteps[]) => void;
  onChange?: (steps: ChatSteps) => void;
  onError?: (message: string) => void;
  now?: () => number;
};

/** Like the Entity's workers: after this many new tool calls, at most this often, at most this many per turn. */
export const STEPS_EVERY_CALLS = 4;
export const STEPS_INTERVAL_MS = 20_000;
export const STEPS_MAX_PER_TURN = 20;
const SUMMARY_TIMEOUT_MS = 30_000;
/**
 * The usage records say a run ended a few seconds before its turn is stored: a stopped chat's final summary waits
 * for its turn this long, checking on every tick.
 */
export const FINAL_WAIT_MS = 60_000;
/** Tells the summarizer the turn is over, so it does not report work in progress. */
export const FINAL_NOTE = 'The agent has finished this turn. Put everything it did under done, leave doing empty, and put under next only what it left for the user.';
const ACTIVITY_MAX_LINES = 120;
const ACTIVITY_MAX_CHARS = 12_000;

type Live = {
  droneId: string;
  chatName: string;
  chatId: string | null;
  turnId: string;
  callsAtLastSummary: number;
  lastSummaryAt: number;
  summaries: number;
  summarizing: boolean;
  /** When it was first seen stopped: its final summary waits for the finished turn to be stored. */
  stoppedAt: number | null;
};

const chatKey = (droneId: string, chatName: string) => `${droneId}\u0000${chatName}`;

/** Tool calls in an activity record: what the step cadence counts. */
export function countToolCalls(activity: AgentRunActivity | null | undefined): number {
  let calls = 0;
  for (const message of activity?.messages ?? []) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const part of message.content) if (part?.type === 'toolCall') calls += 1;
  }
  return calls;
}

/** What an agent did, oldest first, as short lines for the summarizer: its calls, failures and what it said. */
export function activityText(activity: AgentRunActivity | null | undefined): string {
  const lines: string[] = [];
  for (const message of activity?.messages ?? []) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === 'toolCall') {
          const name = String(part.name ?? 'tool');
          const args = part.arguments && typeof part.arguments === 'object' ? describeToolArgs(name, part.arguments) : '';
          lines.push(`called ${name}${args ? `: ${args}` : ''}`);
        } else if (part?.type === 'text' && part.text?.trim()) {
          lines.push(`said: ${part.text.replace(/\s+/g, ' ').trim().slice(0, 240)}`);
        }
      }
    } else if (message.role === 'toolResult' && (message as { isError?: boolean }).isError) {
      const text = Array.isArray(message.content)
        ? message.content.map((part) => part?.text ?? '').join(' ')
        : String(message.content ?? '');
      lines.push(`  -> not done: ${text.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
    }
  }
  // The summarizer needs the recent work most; old lines go first.
  let kept = lines.slice(-ACTIVITY_MAX_LINES);
  while (kept.join('\n').length > ACTIVITY_MAX_CHARS && kept.length > 1) kept = kept.slice(1);
  return kept.join('\n');
}

/**
 * Keeps each agent chat's current turn summarized as done / doing / next, like the Entity's Work view does for its
 * workers. `tick()` looks at the chats with running agent work: one gets a summary after a few new tool calls, at
 * most every 20 seconds, and once more when its turn ends. Each summary is billed to its chat.
 */
export class ChatStepTracker {
  private readonly live = new Map<string, Live>();
  private readonly byChat = new Map<string, ChatSteps>();
  private readonly now: () => number;
  private ticking = false;

  constructor(private readonly deps: ChatStepTrackerDeps) {
    this.now = deps.now ?? Date.now;
    for (const steps of deps.load?.() ?? []) this.byChat.set(chatKey(steps.droneId, steps.chatName), steps);
  }

  steps(filter: { droneId?: string } = {}): ChatSteps[] {
    return [...this.byChat.values()].filter((steps) => !filter.droneId || steps.droneId === filter.droneId);
  }

  /** A renamed or deleted chat keeps no stale summary under its old name. */
  forget(droneId: string, chatName: string): void {
    const key = chatKey(droneId, chatName);
    this.live.delete(key);
    if (this.byChat.delete(key)) this.deps.save?.(this.steps());
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = await this.deps.settings();
      if (!settings.enabled) {
        this.live.clear();
        return;
      }
      const running = new Map(this.deps.runningChats().map((chat) => [chatKey(chat.droneId, chat.chatName), chat]));
      for (const [key, chat] of running) {
        const turn = this.deps.readRunningTurn(chat.droneId, chat.chatName);
        if (!turn) continue;
        let live = this.live.get(key);
        if (!live || live.turnId !== turn.turnId) {
          live = { ...chat, turnId: turn.turnId, callsAtLastSummary: 0, lastSummaryAt: 0, summaries: 0, summarizing: false, stoppedAt: null };
          this.live.set(key, live);
        }
        live.stoppedAt = null;
        const calls = countToolCalls(turn.activity);
        if (live.summarizing || live.summaries >= STEPS_MAX_PER_TURN) continue;
        if (calls - live.callsAtLastSummary < STEPS_EVERY_CALLS || this.now() - live.lastSummaryAt < STEPS_INTERVAL_MS) continue;
        void this.summarize(live, turn, calls, false, settings);
      }
      // A chat that stopped running gets one summary of its finished turn, once that turn is stored.
      for (const [key, live] of this.live) {
        if (running.has(key)) continue;
        live.stoppedAt ??= this.now();
        const turn = this.deps.readLastTurn(live.droneId, live.chatName);
        if (!turn || turn.turnId !== live.turnId) {
          if (this.now() - live.stoppedAt >= FINAL_WAIT_MS) this.live.delete(key);
          continue;
        }
        this.live.delete(key);
        if (countToolCalls(turn.activity) === 0) continue;
        void this.summarize(live, turn, countToolCalls(turn.activity), true, settings);
      }
    } catch (error) {
      this.deps.onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      this.ticking = false;
    }
  }

  private async summarize(live: Live, turn: ChatTurnActivity, calls: number, final: boolean, settings: ChatStepsSettings): Promise<void> {
    live.summarizing = true;
    live.callsAtLastSummary = calls;
    live.lastSummaryAt = this.now();
    live.summaries += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
    try {
      const summary = await this.deps.summarize({
        modelRef: settings.model,
        reasoning: settings.reasoning,
        input: { task: final ? `${turn.prompt}\n\n(${FINAL_NOTE})` : turn.prompt, activity: activityText(turn.activity) },
        signal: controller.signal,
        attribution: { purpose: 'steps', droneId: live.droneId, chatName: live.chatName, ...(live.chatId ? { chatId: live.chatId } : {}) },
      });
      const steps: ChatSteps = {
        droneId: live.droneId,
        chatName: live.chatName,
        turnId: turn.turnId,
        done: summary.done.slice(0, 6),
        // A finished turn is doing nothing, whatever the model says.
        doing: final ? [] : summary.doing.slice(0, 3),
        next: summary.next.slice(0, 6),
        ...(summary.blocker ? { blocker: summary.blocker } : {}),
        updatedAt: new Date(this.now()).toISOString(),
        final,
      };
      const key = chatKey(live.droneId, live.chatName);
      // A running summary that lands after the final one must not replace it.
      const current = this.byChat.get(key);
      if (current?.turnId === steps.turnId && current.final && !final) return;
      this.byChat.set(key, steps);
      this.deps.save?.(this.steps());
      this.deps.onChange?.(steps);
    } catch (error) {
      this.deps.onError?.(`steps for ${live.droneId}/${live.chatName} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
      live.summarizing = false;
    }
  }
}
