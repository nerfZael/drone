import type { EffectSpec } from './channel.js';
import type { LimbRole } from './runtime-state.js';
import type { Schema } from './types.js';
import { watchSchema } from './watch.js';

/** The runtime's own tools, handled by the Entity rather than a channel. */
export const TOOL_SCHEMAS = {
  set_watch: { type: 'object', additionalProperties: false, required: ['watch'], properties: { watch: watchSchema } },
  run_program: {
    type: 'object', additionalProperties: false, required: ['name', 'code'],
    properties: { name: { type: 'string', maxLength: 80 }, label: { type: 'string', maxLength: 40, description: 'A few words saying what it does' }, code: { type: 'string', maxLength: 20_000, description: 'Body of an async function' } },
  },
  stop_output: {
    type: 'object', additionalProperties: false, required: ['reason'],
    properties: { reason: { type: 'string', maxLength: 200 }, scope: { type: 'string', enum: ['work', 'subtree', 'entity'] }, mode: { type: 'string', enum: ['stop', 'freeze'] } },
  },
  resume_output: { type: 'object', additionalProperties: false, properties: {} },
  note: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 500 } } },
  set_timer: {
    type: 'object', additionalProperties: false, required: ['after_ms'],
    properties: { after_ms: { type: 'integer', minimum: 0, maximum: 3_600_000 }, label: { type: 'string', maxLength: 80 } },
  },
  cancel: {
    type: 'object', additionalProperties: false, required: ['id'],
    properties: { id: { type: 'string' }, now: { type: 'boolean', description: 'Stop it at once, dropping partial work, instead of letting it wrap up' } },
  },
  amend: {
    type: 'object', additionalProperties: false, required: ['seq', 'verdict'],
    properties: {
      seq: { type: 'integer', description: 'The message under review; for withdraw, your own earlier correction' },
      verdict: { type: 'string', enum: ['confirm', 'correct', 'expand', 'withdraw'] },
      text: { type: 'string', maxLength: 4000, description: 'For correct: the corrected answer. For expand: what the answer was missing.' },
    },
  },
  handoff: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string', maxLength: 2000 } } },
  dispatch: {
    type: 'object', additionalProperties: false, required: ['task'],
    properties: {
      task: { type: 'string', maxLength: 8000, description: 'The request, with any context the worker needs' },
      name: { type: 'string', maxLength: 60, description: '2–4 words naming the work, e.g. "Flaky login test"' },
      model: { type: 'string', enum: ['task', 'head'], description: 'task (default): the capable model; head: cheaper, for small requests' },
      why: { type: 'string', maxLength: 300, description: 'One short sentence: why this, in the user\'s terms. Say so when the user did not ask for it.' },
      after: { description: 'Start only when these have finished: a worker id, a list of worker ids, or a batch id ("group-7") to wait for every worker in it, including ones added later. Work that combines a batch\'s results (one list at the end) waits on the batch id.', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 20 }] },
      reply_to: { type: 'integer', description: 'The user message seq this answers (default: the latest)' },
    },
  },
  dispatch_many: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: {
      title: { type: 'string', maxLength: 80, description: 'What the batch is, e.g. "Open bug issues". Required for a new batch' },
      batch: { type: 'string', description: 'The id of an existing batch (e.g. "group-27") to add these items to, instead of starting a new one' },
      reply_to: { type: 'integer', description: 'The user message seq this answers (default: the latest)' },
      items: {
        type: 'array', maxItems: 200,
        items: { type: 'object', additionalProperties: false, required: ['task'], properties: { task: { type: 'string', maxLength: 4000 }, name: { type: 'string', maxLength: 60, description: '2–4 words' } } },
      },
      model: { type: 'string', enum: ['task', 'head'] },
      why: { type: 'string', maxLength: 300, description: 'One short sentence: why this, in the user\'s terms. Say so when the user did not ask for it.' },
    },
  },
  fork: {
    type: 'object', additionalProperties: false, required: ['worker', 'task'],
    properties: { worker: { type: 'string' }, task: { type: 'string', maxLength: 8000 }, name: { type: 'string', maxLength: 60, description: '2–4 words' }, reply_to: { type: 'integer' }, why: { type: 'string', maxLength: 300, description: 'One short sentence: why this, in the user\'s terms. Say so when the user did not ask for it.' } },
  },
  steer: {
    type: 'object', additionalProperties: false, required: ['worker', 'text'],
    properties: {
      worker: { type: 'string' }, text: { type: 'string', maxLength: 4000 },
      when: { type: 'string', enum: ['now', 'after'], description: 'now (default): the worker hears it with its next tool result. after: it continues with this in the same conversation once it finishes its current work.' },
      why: { type: 'string', maxLength: 300, description: 'One short sentence: why this, in the user\'s terms. Say so when the user did not ask for it.' },
    },
  },
  claim: {
    type: 'object', additionalProperties: false, required: ['paths'],
    properties: { paths: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 50 }, note: { type: 'string', maxLength: 200 } },
  },
  release: { type: 'object', additionalProperties: false, properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 50 } } },
  share: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } },
  finish_task: {
    type: 'object', additionalProperties: false, required: ['result', 'points'],
    properties: {
      result: { type: 'string', maxLength: 8000, description: 'The outcome in one sentence of at most 200 characters: what you found or did, not what you looked at. Findings go in points.' },
      points: {
        type: 'array', maxItems: 10, description: 'The findings or parts of your work, 2–8 of them, most important first. [] only when the result is a single thing (one answer, one change).',
        items: {
          type: 'object', additionalProperties: false, required: ['label', 'text'],
          properties: {
            label: { type: 'string', maxLength: 48, description: '2–4 words' },
            text: { type: 'string', maxLength: 240, description: 'One short sentence' },
            section: { type: 'string', maxLength: 160, description: 'The heading in your report file that this point expands, if any' },
          },
        },
      },
    },
  },
  report_round: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 200, description: 'One line: what changed in this round' } } },
  ask: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', maxLength: 4000, description: 'The question, or with questions a short line introducing them' }, questions: { type: 'array', maxItems: 20, description: 'Several questions at once, each with its own options', items: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', maxLength: 500 }, options: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string', maxLength: 120 }, recommended: { type: 'boolean' } } } } } } }, options: { type: 'array', maxItems: 6, description: 'Answers the user can click instead of typing, for a question with a few likely answers. Mark the one you recommend.', items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string', maxLength: 120 }, recommended: { type: 'boolean' } } } } } },
} satisfies Record<string, Schema>;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export interface ToolPolicy {
  role: LimbRole;
  /** Watches and programs are allowed in this session. */
  codeLimbs: boolean;
  review: 'off' | 'separate' | 'head';
}

const ROUTER: ToolName[] = ['dispatch', 'dispatch_many', 'fork', 'steer', 'cancel'];

/**
 * Which runtime tools each LLM limb may use: the one place permissions live. A limb is offered exactly these,
 * and a call to anything else is refused. Code limbs act only through effects, with their author's permissions.
 */
export function runtimeTools({ role, codeLimbs, review }: ToolPolicy): ToolName[] {
  const code: ToolName[] = codeLimbs ? ['set_watch', 'run_program'] : [];
  switch (role) {
    case 'head': return [...ROUTER, ...(review === 'head' ? ['amend' as const] : []), ...code, 'stop_output', 'resume_output', 'note', 'set_timer'];
    case 'voice': return ['note', ...ROUTER, 'handoff'];
    case 'reviewer': return ['amend', 'handoff', 'note'];
    case 'task': return [...code, 'stop_output', 'resume_output', 'note', 'set_timer', 'cancel', 'claim', 'release', 'share', 'ask', 'report_round', 'finish_task'];
    default: return [];
  }
}

/** The reviewer only reads the world; every other limb may use every channel effect. */
export const mayUseEffect = (role: LimbRole, spec: EffectSpec) => role !== 'reviewer' || !!spec.readonly;

const NOTE = 'Keep a short note in your state; you remember nothing else between wakes.';

export const TOOL_DESCRIPTIONS: Record<ToolName, string | ((role: LimbRole) => string)> = {
  dispatch: 'Start a worker (a capable model) on a user request right away. It replies to the user itself. Use "after" to start it only when other workers finish: one, several, or a whole batch (to combine their results).',
  dispatch_many: 'Start one worker per item as one batch with a title, for many independent items of the same kind (one per issue, per file). To add items to a batch that exists ("make it 6"), pass its id as batch: it keeps one progress line. Past the running limit, workers queue.',
  fork: 'Start a worker from another worker\'s conversation, for a request that builds on its context.',
  steer: 'Send a message to one worker: it gets it with its next tool result (or wakes up with it).',
  cancel: role => role === 'voice' ? 'Cancel a worker by id. now: true stops it at once.'
    : role === 'head' ? 'Cancel a worker, or one of your watches or programs, by id. A worker gets a few seconds to wrap up; now: true stops it at once, dropping partial work.'
    : 'Cancel one of your watches or programs by id.',
  amend: role => role === 'head'
    ? 'Your verdict on one of the voice\'s answers under review: confirm, correct (shown struck through, your text below), or expand.'
    : 'Your verdict on one of the answers under review: confirm it, correct it (the original is shown struck through, your text below it), or expand it. Withdraw one of your own earlier corrections that was wrong: the original is restored.',
  handoff: role => role === 'reviewer'
    ? 'Wake the head for work a correction needs (starting a worker, fixing something promised but not done). The note says what. Never use it to say that nothing is needed.'
    : 'Wake the head (slower, smarter) for anything you should not handle yourself. The note says what is needed.',
  set_watch: 'Install a watch: a code reflex that reacts in ~0 ms without you.',
  run_program: 'Run a JavaScript program (the body of an async function) as a code limb.',
  stop_output: 'Stop output. scope "work" (default): your programs, watches and task limbs, not you; "subtree": you too. mode "stop" (default) cancels programs; "freeze" pauses everything at its next action until resume_output.',
  resume_output: 'Resume output after a stop.',
  note: NOTE,
  set_timer: 'Be woken after a delay.',
  claim: 'Claim files or folders you are working on, so other workers leave them alone. Writing a file claims it automatically.',
  release: 'Release your claims (all, or the given paths).',
  share: 'Share a discovery that other workers should know (e.g. a root cause).',
  finish_task: 'Finish: first say your answer to the user, then call this with the outcome in one sentence, and its points when there are several findings or parts.',
  report_round: 'Only for open-ended work you keep iterating on: after each round of changes, one line saying what changed. This is how the user follows your rounds, so do not also say them in the chat. Not for a single task.',
  ask: 'Ask the user something you need answered before you can go on. It is posted in the chat and ends your turn: you wait, and their answer wakes you with your conversation intact. When the likely answers are few, pass them as options for the user to click, the one you recommend marked; several questions go together in questions, each with its options. Do not also finish.',
};
