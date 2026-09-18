import type { ReflexActionSpec, ReflexRule, ReflexTable } from '@drone/reflex';
import { COMPANION_FACT_DESCRIPTIONS, COMPANION_SPEECH_FACTS, type CompanionAutonomy } from './senses';

export const COMPANION_REFLEX_ACTIONS: ReflexActionSpec[] = [
  { name: 'send', description: 'Delegate the unsent transcript to the Companion backend now and advance the cursor past it.' },
  { name: 'skip', description: 'Consume the unsent transcript without delegating, because it is not for the assistant. Code applies this only after two seconds of silence.' },
  { name: 'cancel', description: 'Stop the backend work that is running or was just requested, and consume the transcript that asked for it.' },
  { name: 'nudge', description: 'Send the running backend a short status-check steering message asking it to report progress and continue. Autonomous; needs no speech.' },
  { name: 'notify', description: 'Show the user a short on-screen note (args.text). Autonomous; needs no speech.' },
  { name: 'wait', description: 'Do nothing yet. Every word is retained and reconsidered as more speech, silence, or backend activity arrives.' },
];

export const COMPANION_REFLEX_STATE_DESCRIPTION = [
  'unsentTranscript: speech not yet delegated, growing while the user speaks. Partial sentences are normal. Empty when the loop woke for a non-speech reason.',
  'previousDelegatedTranscripts: up to five earlier transcripts already sent to the backend. Context only; the backend will not receive them again.',
  'timing.silenceMs: milliseconds since the last new or revised transcript text. Metadata, not spoken words.',
  'backend.status: idle or working, whether a delegated request is still running.',
  'backend.workingForSeconds, backend.recentActivity, backend.lastReply, backend.error: what the backend has been doing, when the senses are on.',
  'app: the selected drone, chat, repository, and pane, when known.',
  'events: event notifications delivered to the Companion conversation, when any.',
  'facts: booleans computed in code (see the fact list). They are certain; do not second-guess them.',
].join('\n');

export const COMPANION_REFLEX_PURPOSE = 'Companion is a voice assistant inside Drone Hub. A streaming transcriber feeds it text while the user speaks, and its senses report what the backend agent and the app are doing. The loop decides, several times per second, whether unsent speech should be delegated now, held, dropped as not addressed to the assistant, or treated as a cancellation, and, when autonomy is on, whether the backend needs a nudge or the user needs a note.';

export const COMPANION_REFLEX_SKIP_SILENCE_MS = 2_000;

const speech = { question: 'fact:speechPending', is: 'true' } as const;

export function companionReflexTable(seedInstructions: string, options: { now?: () => number; id?: string; autonomy?: CompanionAutonomy } = {}): ReflexTable {
  const autonomous = (options.autonomy ?? 'off') !== 'off';
  const guard = (rule: ReflexRule): ReflexRule => (autonomous && rule.when ? { ...rule, when: { all: [speech, rule.when] } } : rule);
  const speechRules: ReflexRule[] = [
    { id: 'cancel', description: 'A clear cancellation aimed at the assistant stops running work.', do: 'cancel', wake: 'user cancelled work',
      when: { all: [{ question: 'intent', is: 'cancel', minProbability: 0.8 }, { question: 'addressed', atLeast: 0.5 }] } },
    { id: 'chatter', description: 'Confident chatter that is not aimed at the assistant is dropped once the user has gone quiet.', do: 'skip',
      when: { all: [{ question: 'intent', is: 'chatter', minProbability: 0.85 }, { question: 'addressed', atMost: 0.5 }] } },
    { id: 'chatter-elsewhere', description: 'Moderately confident chatter that is also not addressed to the assistant is dropped once the user has gone quiet.', do: 'skip',
      when: { all: [{ question: 'intent', is: 'chatter', minProbability: 0.6 }, { question: 'addressed', atMost: 0.35 }] } },
    { id: 'not-addressed', description: 'Speech clearly aimed elsewhere is dropped once the user has gone quiet.', do: 'skip',
      when: { question: 'addressed', atMost: 0.15 } },
    { id: 'send', description: 'The delegation gate says the request is ready, the speech is addressed to the assistant, and it is neither chatter nor a bare greeting.', do: 'send',
      when: { all: [{ question: 'delegation', is: 'send' }, { question: 'addressed', atLeast: 0.4 }, { not: { question: 'intent', is: 'chatter', minProbability: 0.6 } }, { not: { question: 'intent', is: 'greeting', minProbability: 0.5 } }] } },
    { id: 'send-greeting', description: 'A greeting aimed at the assistant goes in one piece once the user pauses.', do: 'send',
      when: { all: [{ question: 'intent', is: 'greeting', minProbability: 0.5 }, { question: 'addressed', atLeast: 0.5 }, { question: 'fact:userPaused', is: 'true' }] } },
    { id: 'send-after-stop', description: 'Once the user has stopped talking, an addressed request goes even if it is vague, so the backend can ask.', do: 'send',
      when: { all: [{ question: 'intent', is: 'request', minProbability: 0.6 }, { question: 'addressed', atLeast: 0.6 }, { question: 'fact:userStopped', is: 'true' }] } },
  ].map(guard);
  const autonomousRules: ReflexRule[] = autonomous ? [
    { id: 'stalled-nudge', description: 'A backend with no activity for a long time gets a status check while the user is not speaking.', do: 'nudge', wake: 'backend stalled',
      when: { all: [{ question: 'fact:backendStalled', is: 'true' }, { question: 'fact:speechPending', is: 'false' }] } },
    { id: 'drift-notify', description: 'Tell the user when the backend seems to be working on something other than what was asked.', do: 'notify',
      args: { text: 'Companion may have drifted from your request. Say "cancel that" to stop it.' },
      when: { all: [{ question: 'fact:backendWorking', is: 'true' }, { question: 'expect:backendOnTrack', atMost: 0.3 }] } },
  ] : [];
  return {
    id: options.id ?? 'companion-voice',
    version: 1,
    source: 'default',
    createdAt: options.now?.() ?? Date.now(),
    preamble: `State fields:\n${COMPANION_REFLEX_STATE_DESCRIPTION}`,
    questions: {
      delegation: {
        type: 'choice',
        instructions: `The timing.silenceMs field is an estimate of silence rather than acoustic voice detection. Use it to apply any timing rules in the following instructions.\n\n${seedInstructions}`,
        criteria: {
          send: 'A complete request or correction should be sent to the Companion backend now.',
          wait: 'Do not delegate yet. Retain the entire transcript and reconsider as more speech arrives or silence increases. Always wait when unsentTranscript is empty.',
        },
      },
      intent: {
        type: 'choice',
        instructions: 'Classify what the unsentTranscript is, on its own, relative to previousDelegatedTranscripts and backend.status. Choose chatter when unsentTranscript is empty.',
        criteria: {
          request: 'Asks the assistant to do or answer something, or supplies information for a task. Includes vague or incomplete requests still being spoken.',
          greeting: 'A social opener aimed at the assistant with no task in it yet: hello, hey, what\'s up, good morning, are you there.',
          correction: 'Changes, fixes, or adds to a request that already appears in previousDelegatedTranscripts, for example "I meant", "also", "instead", or "actually make it".',
          cancel: 'Tells the assistant to stop, abort, forget, undo the request, or not do the running work. Words like "never mind", "cancel that", "stop", "forget it", "don\'t do that" aimed at the assistant\'s work.',
          chatter: 'Not for the assistant: talking to another person, thinking aloud without asking for anything, filler, reading text aloud, an explicit "don\'t do anything yet", or an empty transcript.',
        },
      },
      addressed: {
        type: 'boolean',
        instructions: 'Is the unsentTranscript addressed to the assistant?',
        criteria: {
          true: 'The user speaks to the assistant: gives instructions, asks questions, or corrects it, even without naming it.',
          false: 'The user speaks to someone else, to themselves, or reads or dictates text without addressing the assistant. Also false when unsentTranscript is empty.',
        },
      },
    },
    facts: autonomous ? { ...COMPANION_FACT_DESCRIPTIONS } : Object.fromEntries(COMPANION_SPEECH_FACTS.map(name => [name, COMPANION_FACT_DESCRIPTIONS[name]])),
    ...(autonomous ? {
      expectations: {
        backendOnTrack: {
          instructions: 'Answer true when backend.status is idle. When backend.status is working, is backend.recentActivity and backend.lastReply consistent with what previousDelegatedTranscripts asked for?',
          criteria: { true: 'The backend is idle, or its recent tool calls and reply serve the delegated requests.', false: 'The backend is working and its recent tool calls or reply concern something the user did not ask for.' },
          threshold: 0.3,
        },
      },
    } : {}),
    rules: [...speechRules.slice(0, 1), ...autonomousRules, ...speechRules.slice(1), { id: 'wait', description: 'Fallback: keep listening.', do: 'wait', when: null }],
    // Compiles take tens of seconds on a reasoning model, so wakes are rare by design.
    wake: { minConfidence: 0.55, lowConfidenceTicks: 4, cooldownMs: 180_000, maxTableAgeMs: 30 * 60_000 },
  };
}
