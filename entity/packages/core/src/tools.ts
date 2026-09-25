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
      seq: { type: 'integer', description: 'The message under review' },
      verdict: { type: 'string', enum: ['confirm', 'correct', 'expand'] },
      text: { type: 'string', maxLength: 4000, description: 'For correct: the corrected answer. For expand: what the answer was missing.' },
    },
  },
  handoff: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string', maxLength: 2000 } } },
  dispatch: {
    type: 'object', additionalProperties: false, required: ['task'],
    properties: {
      task: { type: 'string', maxLength: 8000, description: 'The request, with any context the worker needs' },
      name: { type: 'string', maxLength: 60, description: 'Short label, e.g. "flaky test"' },
      model: { type: 'string', enum: ['task', 'head'], description: 'task (default): the capable model; head: cheaper, for small requests' },
      after: { type: 'string', description: 'Worker id to wait for before starting' },
      reply_to: { type: 'integer', description: 'The user message seq this answers (default: the latest)' },
    },
  },
  dispatch_many: {
    type: 'object', additionalProperties: false, required: ['title', 'items'],
    properties: {
      title: { type: 'string', maxLength: 80, description: 'What the batch is, e.g. "Open bug issues"' },
      items: {
        type: 'array', maxItems: 200,
        items: { type: 'object', additionalProperties: false, required: ['task'], properties: { task: { type: 'string', maxLength: 4000 }, name: { type: 'string', maxLength: 60 } } },
      },
      model: { type: 'string', enum: ['task', 'head'] },
    },
  },
  fork: {
    type: 'object', additionalProperties: false, required: ['worker', 'task'],
    properties: { worker: { type: 'string' }, task: { type: 'string', maxLength: 8000 }, name: { type: 'string', maxLength: 60 }, reply_to: { type: 'integer' } },
  },
  steer: {
    type: 'object', additionalProperties: false, required: ['worker', 'text'],
    properties: {
      worker: { type: 'string' }, text: { type: 'string', maxLength: 4000 },
      when: { type: 'string', enum: ['now', 'after'], description: 'now (default): the worker hears it with its next tool result. after: it continues with this in the same conversation once it finishes its current work.' },
    },
  },
  claim: {
    type: 'object', additionalProperties: false, required: ['paths'],
    properties: { paths: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 50 }, note: { type: 'string', maxLength: 200 } },
  },
  release: { type: 'object', additionalProperties: false, properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 50 } } },
  share: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } },
  finish_task: { type: 'object', additionalProperties: false, required: ['result'], properties: { result: { type: 'string', maxLength: 8000 } } },
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
    case 'task': return [...code, 'stop_output', 'resume_output', 'note', 'set_timer', 'cancel', 'claim', 'release', 'share', 'finish_task'];
    default: return [];
  }
}

/** The reviewer only reads the world; every other limb may use every channel effect. */
export const mayUseEffect = (role: LimbRole, spec: EffectSpec) => role !== 'reviewer' || !!spec.readonly;

const NOTE = 'Keep a short note in your state; you remember nothing else between wakes.';

export const TOOL_DESCRIPTIONS: Record<ToolName, string | ((role: LimbRole) => string)> = {
  dispatch: 'Start a worker (a capable model) on a user request right away. It replies to the user itself. Use "after" to start it only when another worker finishes.',
  dispatch_many: 'Start one worker per item as one batch with a title, for many independent items of the same kind (one per issue, per file). Past the running limit, workers queue.',
  fork: 'Start a worker from another worker\'s conversation, for a request that builds on its context.',
  steer: 'Send a message to one worker: it gets it with its next tool result (or wakes up with it).',
  cancel: role => role === 'voice' ? 'Cancel a worker by id. now: true stops it at once.'
    : role === 'head' ? 'Cancel a worker, or one of your watches or programs, by id. A worker gets a few seconds to wrap up; now: true stops it at once, dropping partial work.'
    : 'Cancel one of your watches or programs by id.',
  amend: role => role === 'head'
    ? 'Your verdict on one of the voice\'s answers under review: confirm, correct (shown struck through, your text below), or expand.'
    : 'Your verdict on one of the answers under review: confirm it, correct it (the original is shown struck through, your text below it), or expand it.',
  handoff: role => role === 'reviewer'
    ? 'Wake the head for work a correction needs (starting a worker, fixing something promised but not done). The note says what.'
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
  finish_task: 'Finish: first say your answer to the user, then call this with a one-line summary.',
};
