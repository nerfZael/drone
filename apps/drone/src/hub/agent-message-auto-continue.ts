import { extractAgentCopilotFromAgentMessage } from './agent-copilot-parser';
import type { LlmProviderId } from './hub-settings';
import { defaultHubLlmModelId, providerDisplayName, resolveHubLlmRuntime } from './llm-runtime';

export type AgentMessageAutoContinueBucket = 'user-turn' | 'continue';

export type AgentMessageAutoContinueClassification = {
  bucket: AgentMessageAutoContinueBucket;
  reason: string;
  source: 'llm' | 'agent-copilot-json' | 'heuristic';
};

const AUTO_CONTINUE_PROGRESS_PATTERNS: RegExp[] = [
  /\b(i['’]?m|i am) taking\b/,
  /\b(i['’]?m|i am) (running|checking|verifying|investigating|implementing|working|resuming|continuing)\b/,
  /\bnext (i['’]?m|i am|i will)\b/,
  /\bthe next (step|set of edits|change|changes)\b/,
  /\bstill (need|needs|running|checking|verifying|investigating|implementing|working)\b/,
  /\bi still need to\b/,
  /\bwhen .* comes back, i will\b/,
  /\bbefore i call this finished\b/,
  /\bmore to do\b/,
];

const AUTO_CONTINUE_USER_TURN_PATTERNS: RegExp[] = [
  /^(i['’]?m|i am) aligned\b.*\byou want\b/,
];

const AUTO_CONTINUE_DELIVERY_PATTERNS: RegExp[] = [
  /^pr created and merged\b/,
  /^pull request created and merged\b/,
];

const AUTO_CONTINUE_COMPLETION_PATTERNS: RegExp[] = [
  /^(i )?(updated|continued|renamed|changed|fixed|implemented|wired|added|removed|replaced|converted|swapped|refined|cleaned up|moved)\b/,
  /^the (review|work|task|change|changes) (is|are) complete\b/,
  /^the code changes are in\b/,
  /^done\b/,
  /^finished\b/,
  /^completed\b/,
];

function defaultModelId(provider: LlmProviderId): string {
  return defaultHubLlmModelId(provider, 'small');
}

function normalizeNewlines(s: string): string {
  return String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function clip(s: string, maxChars: number): string {
  const text = normalizeNewlines(String(s ?? '')).trim();
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

function normalizeClassifierSignalText(textRaw: string): string {
  return normalizeNewlines(textRaw)
    .toLowerCase()
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function classifyAgentMessageAutoContinueBypass(textRaw: string): AgentMessageAutoContinueClassification | null {
  const extracted = extractAgentCopilotFromAgentMessage(String(textRaw ?? ''));
  if (!extracted.copilot && !extracted.error) return null;
  return {
    bucket: 'user-turn',
    reason: extracted.error
      ? 'Message contains agent copilot JSON; auto-continue is disabled for structured copilot handoffs.'
      : 'Message contains agent copilot JSON; auto-continue is disabled for structured copilot handoffs.',
    source: 'agent-copilot-json',
  };
}

export function classifyAgentMessageAutoContinueHeuristic(textRaw: string): AgentMessageAutoContinueClassification | null {
  const text = clip(String(textRaw ?? ''), 14_000);
  if (!text) return null;

  const normalized = normalizeClassifierSignalText(text);
  if (!normalized) return null;

  if (AUTO_CONTINUE_PROGRESS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      bucket: 'continue',
      reason: 'Message explicitly says the agent is still working or is taking the next step now.',
      source: 'heuristic',
    };
  }

  const compact = normalized.replace(/\s+/g, ' ').trim();
  if (AUTO_CONTINUE_USER_TURN_PATTERNS.some((pattern) => pattern.test(compact))) {
    return {
      bucket: 'user-turn',
      reason: 'Message acknowledges or restates the user request instead of indicating active continued execution.',
      source: 'heuristic',
    };
  }

  if (AUTO_CONTINUE_DELIVERY_PATTERNS.some((pattern) => pattern.test(compact))) {
    return {
      bucket: 'user-turn',
      reason: 'Agent reports a completed PR/merge outcome and hands the result back to the user.',
      source: 'heuristic',
    };
  }

  const isShortCompletionUpdate = compact.length <= 240 && AUTO_CONTINUE_COMPLETION_PATTERNS.some((pattern) => pattern.test(compact));
  if (isShortCompletionUpdate) {
    return {
      bucket: 'user-turn',
      reason: 'Short past-tense completion update with no explicit next-step language; keep control with the user.',
      source: 'heuristic',
    };
  }

  return null;
}

export async function classifyAgentMessageAutoContinue(
  textRaw: string,
  llm?: { provider?: LlmProviderId; apiKey?: string },
): Promise<AgentMessageAutoContinueClassification> {
  const bypass = classifyAgentMessageAutoContinueBypass(textRaw);
  if (bypass) return bypass;

  const heuristic = classifyAgentMessageAutoContinueHeuristic(textRaw);
  if (heuristic) return heuristic;

  const text = clip(String(textRaw ?? ''), 14_000);
  if (!text) throw new Error('missing agent message');

  const runtime = await resolveHubLlmRuntime(llm);
  const modelId = String(process.env.DRONE_HUB_AGENT_MESSAGE_AUTO_CONTINUE_MODEL ?? '').trim() || defaultModelId(runtime.provider);

  const schema = runtime.z.object({
    bucket: runtime.z.enum(['user-turn', 'continue']),
    reason: runtime.z
      .string()
      .min(1)
      .max(240)
      .describe('Brief justification for the chosen bucket.'),
  });

  const system = [
    'You classify a single agent response from a developer chat.',
    'Return ONLY the structured output required by the schema.',
    'Pick `user-turn` when the agent is done, answered the question, is asking the user for input, or is intentionally waiting on another agent/copilot/system.',
    'Pick `continue` when the agent clearly stopped mid-task, gave only a progress update, said it will do more next, or is still investigating/running/checking/implementing and the work should keep going.',
    'A short past-tense completion summary like "updated X across the UI" is usually `user-turn`, not `continue`, unless the message also says more work is still happening now.',
    'Do not classify a message as `continue` just because it is brief or sounds like a commit summary.',
    'Treat implementation-complete messages with verification still running as `continue` if the agent is explicitly still doing that verification now.',
    'Do not rely on whether the message starts with a specific phrase.',
    'Be conservative: if the message hands control back to the user, choose `user-turn`.',
  ].join('\n');

  const prompt = ['Classify this agent response:', '', clip(text, 14_000)].join('\n');

  let object: any = null;
  try {
    const out = await runtime.generateObject({
      model: runtime.modelFactory(modelId),
      schema,
      system,
      prompt,
      temperature: 0,
      maxRetries: 2,
    });
    object = out.object;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    throw new Error(`${providerDisplayName(runtime.provider)} auto-continue classification failed (model: ${modelId}): ${msg}`);
  }

  return {
    bucket: object?.bucket === 'continue' ? 'continue' : 'user-turn',
    reason: clip(String(object?.reason ?? ''), 240) || 'No reason provided.',
    source: 'llm',
  };
}
