import { runReflexStory, type ReflexBrainOutput, type ReflexCompileInput, type ReflexEvaluate, type ReflexStory, type ReflexStoryResult, type ReflexTable, type ReflexTick } from '@drone/reflex';
import { CompanionReflexSession, type CompanionReflexDecision, type CompanionReflexWake } from './session';
import type { CompanionTranscriptSnapshot } from './transcript';
import type { CompanionAutonomy, CompanionObservation } from './senses';

/** Host events a Companion story can replay: transcriber deltas and finals, and backend state changes. */
export type CompanionStoryEvent =
  | { type: 'delta'; text: string; item?: string }
  | { type: 'final'; text: string; item?: string }
  | { type: 'backend'; status: 'idle' | 'working'; lastReply?: string; activity?: string[]; /** How long ago the backend last did something, for stall stories. */ quietForMs?: number; startedAgoMs?: number }
  | { type: 'event'; text: string };

export type CompanionStory = ReflexStory<CompanionStoryEvent>;

const delta = (text: string, item = '1'): CompanionStoryEvent => ({ type: 'delta', text, item });
const final = (text: string, item = '1'): CompanionStoryEvent => ({ type: 'final', text, item });

/** User stories with the actions each window must and must not produce. Timings are real-time offsets. */
export const COMPANION_REFLEX_STORIES: CompanionStory[] = [
  { name: 'complete request while still speaking', description: 'A clear request is delegated before the user finishes explaining why.', settleMs: 1_500, steps: [
    { at: 0, event: delta('Open the settings page'), label: 'request' },
    { at: 300, event: delta(' and switch to the Companion tab'), expect: ['send'], forbid: ['cancel', 'skip'], label: 'request completes' },
    { at: 1_400, event: delta(' because I want to check the voice mode and I will keep talking for a bit'), forbid: ['cancel'], label: 'explanation continues' },
  ] },
  { name: 'pause mid-thought', description: 'An unfinished request waits; the rest of it arrives after a pause.', settleMs: 1_500, steps: [
    { at: 0, event: delta('Could you open'), forbid: ['send', 'skip', 'cancel'], label: 'fragment' },
    { at: 1_200, event: delta(' the settings page please'), expect: ['send'], label: 'completion' },
  ] },
  { name: 'cancel running work', description: 'A cancellation aimed at the assistant stops the running request instead of being delegated.', settleMs: 3_000, steps: [
    { at: 0, event: delta('Rename the current chat to Alpha'), expect: ['send'], label: 'request' },
    { at: 900, event: { type: 'backend', status: 'working' } },
    { at: 1_000, event: delta('actually never mind, cancel that', '2'), expect: ['cancel'], forbid: ['send'], label: 'cancel' },
  ] },
  { name: 'correction after delegation', description: 'A correction of delegated work is delegated as a follow-up, not treated as a cancellation.', settleMs: 3_000, steps: [
    { at: 0, event: delta('Rename the current chat to Alpha'), expect: ['send'], label: 'request' },
    { at: 900, event: { type: 'backend', status: 'working' } },
    { at: 1_000, event: delta('sorry, I meant Beta, not Alpha', '2'), expect: ['send'], forbid: ['cancel', 'skip'], label: 'correction' },
  ] },
  { name: 'background conversation', description: 'Talk aimed at someone else is never delegated and is dropped after silence.', settleMs: 3_500, steps: [
    { at: 0, event: delta("yeah let's grab lunch at one, that works for me, see you there"), forbid: ['send', 'cancel'], label: 'chatter' },
    { at: 200, event: final("yeah let's grab lunch at one, that works for me, see you there"), expect: ['skip'], forbid: ['send', 'cancel'], label: 'settled chatter' },
  ] },
  { name: 'thinking aloud', description: 'Deliberation without a request is not delegated.', settleMs: 3_000, steps: [
    { at: 0, event: delta("hmm, maybe I should refactor the router first, or maybe not, I'm not sure yet"), forbid: ['send', 'cancel'], label: 'deliberation' },
  ] },
  { name: 'explicit hold', description: 'An explicit request not to act is respected.', settleMs: 3_000, steps: [
    { at: 0, event: delta("don't do anything yet, I'm just reading this out loud: open settings and delete the chat"), forbid: ['send', 'cancel'], label: 'hold' },
  ] },
  { name: 'greeting gets a reply', description: 'A greeting aimed at the assistant is delegated so it can answer, not dropped as chatter.', settleMs: 2_500, steps: [
    { at: 0, event: delta('hey'), forbid: ['send', 'skip'], label: 'opener' },
    { at: 400, event: delta(", what's up?", '2'), expect: ['send'], forbid: ['skip', 'cancel'], label: 'greeting complete' },
  ] },
  { name: 'vague request after a stop', description: 'A request too vague to act on still goes once the user has clearly stopped, so the backend can ask.', settleMs: 5_000, steps: [
    { at: 0, event: delta('I need some help with doing'), forbid: ['send', 'skip'], label: 'fragment' },
    { at: 500, event: delta(' my tasks', '2'), expect: ['send'], forbid: ['skip', 'cancel'], label: 'stopped' },
  ] },
  { name: 'non-English request', description: 'A complete request in another language is delegated.', settleMs: 1_500, steps: [
    { at: 0, event: delta('打开设置页面'), expect: ['send'], forbid: ['skip'], label: 'request' },
  ] },
];

/** Stories that need the senses: they run with autonomy observe or act and never involve speech after the setup. */
export const COMPANION_AUTONOMOUS_STORIES: CompanionStory[] = [
  { name: 'stalled backend gets a nudge', description: 'A backend that has done nothing for a minute is asked for a status check while the user is quiet.', settleMs: 2_500, steps: [
    { at: 0, event: delta('Rename the current chat to Alpha'), expect: ['send'], label: 'request' },
    { at: 600, event: { type: 'backend', status: 'working', activity: ['get_app_context'], quietForMs: 60_000, startedAgoMs: 65_000 }, expect: ['nudge'], forbid: ['send', 'cancel'], label: 'stall' },
  ] },
  { name: 'busy backend is left alone', description: 'A backend with recent activity is not nudged.', settleMs: 2_500, steps: [
    { at: 0, event: delta('Rename the current chat to Alpha'), expect: ['send'], label: 'request' },
    { at: 600, event: { type: 'backend', status: 'working', activity: ['get_app_context', 'list_chats'], quietForMs: 2_000, startedAgoMs: 5_000 }, forbid: ['nudge', 'notify', 'send', 'cancel'], label: 'busy' },
  ] },
  { name: 'drifting backend gets a note', description: 'A backend deleting things when asked to rename gets flagged to the user.', settleMs: 2_500, steps: [
    { at: 0, event: delta('Rename the current chat to Alpha'), expect: ['send'], label: 'request' },
    { at: 600, event: { type: 'backend', status: 'working', activity: ['delete_chat_group', 'delete_chat'], quietForMs: 1_000, startedAgoMs: 4_000 }, expect: ['notify'], forbid: ['nudge', 'send'], label: 'drift' },
  ] },
];

export type CompanionStoryRunOptions = {
  evaluate: ReflexEvaluate;
  compile?(input: ReflexCompileInput, signal: AbortSignal): Promise<ReflexBrainOutput>;
  seedInstructions: string;
  table?: ReflexTable;
  intervalMs?: number;
  skipSilenceMs?: number;
  /** Accept delegations. Defaults to accepting immediately. */
  send?(transcript: string): Promise<void>;
  autonomy?: CompanionAutonomy;
  now?(): number;
  sleep?(ms: number): Promise<void>;
};

export type CompanionStoryRun = ReflexStoryResult & {
  decisions: CompanionReflexDecision[];
  wakes: CompanionReflexWake[];
  /** Wakes the loop requested while the brain was off. */
  wouldWake: number;
  delegated: string[];
  cancelled: number;
  nudges: string[];
  notes: string[];
  tokens: { input: number; output: number } | null;
};

/** Run one story against a fresh session. The evaluator can be scripted (tests) or live Jev (eval script). */
export async function runCompanionStory(story: CompanionStory, options: CompanionStoryRunOptions): Promise<CompanionStoryRun> {
  const listeners = new Set<(tick: ReflexTick<unknown>) => void>();
  const decisions: CompanionReflexDecision[] = [];
  const wakes: CompanionReflexWake[] = [];
  const delegated: string[] = [];
  const nudges: string[] = [];
  const notes: string[] = [];
  let cancelled = 0;
  const now = options.now ?? Date.now;
  let observation: CompanionObservation = { backend: { status: 'idle' } };
  let events: string[] = [];
  let usage: { input: number; output: number } | null = null;
  const session = new CompanionReflexSession({
    seedInstructions: options.seedInstructions, table: options.table, intervalMs: options.intervalMs ?? 250, skipSilenceMs: options.skipSilenceMs, now: options.now,
    evaluate: async (state, questions, signal) => {
      const answers = await options.evaluate(state, questions, signal);
      const reported = (answers as { usage?: { input?: number; output?: number } }).usage;
      if (reported) usage = { input: (usage?.input ?? 0) + (reported.input ?? 0), output: (usage?.output ?? 0) + (reported.output ?? 0) };
      return answers;
    },
    compile: options.compile,
    autonomy: options.autonomy,
    senseIntervalMs: 100,
    send: async (transcript, _signal, origin) => { if (origin === 'nudge') nudges.push(transcript); else delegated.push(transcript); await options.send?.(transcript); },
    cancel: async () => { cancelled += 1; observation = { ...observation, backend: { status: 'idle' } }; },
    senses: { observe: () => ({ ...observation, events: [...events] }), notify: text => notes.push(text) },
    onDecision: decision => decisions.push(decision),
    onWake: wake => wakes.push(wake),
  });
  const forward = (tick: ReflexTick<CompanionTranscriptSnapshot>) => listeners.forEach(listener => listener(tick as ReflexTick<unknown>));
  // Observe ticks through the recorder-facing hook without touching the private loop.
  const recordOriginal = session.recorder.record.bind(session.recorder);
  session.recorder.record = tick => { recordOriginal(tick); forward(tick); };
  const result = await runReflexStory<CompanionStoryEvent>(story, {
    apply: event => {
      if (event.type === 'delta') session.append(event.text, event.item ?? '1');
      else if (event.type === 'final') session.complete(event.text, event.item ?? '1');
      else if (event.type === 'event') events = [...events, event.text];
      else observation = { backend: { status: event.status, ...(event.lastReply ? { lastReply: event.lastReply, lastReplyAt: now() } : {}), ...(event.activity ? { activity: event.activity } : {}),
        ...(event.status === 'working' ? { startedAt: now() - (event.startedAgoMs ?? 0), lastActivityAt: now() - (event.quietForMs ?? 0) } : {}) } };
    },
    onTick: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    drain: () => session.idle(),
    finish: () => session.stop(),
    sleep: options.sleep, now: options.now,
  });
  return { ...result, decisions, wakes: wakes.filter(wake => !wake.disabled), wouldWake: wakes.filter(wake => wake.disabled).length, delegated, cancelled, nudges, notes, tokens: usage };
}
