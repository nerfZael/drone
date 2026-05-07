import type { LlmProviderId } from './hub-settings';
import { defaultHubLlmModelId, providerDisplayName, resolveHubLlmRuntime } from './llm-runtime';

export type AgentSuggestionKind =
  | 'approval'
  | 'question'
  | 'correction'
  | 'instruction'
  | 'review'
  | 'commit'
  | 'status'
  | 'none';

export type AgentSuggestionResult =
  | {
      outcome: 'suggest';
      suggestion: string;
      reason: string;
      kind: Exclude<AgentSuggestionKind, 'none'>;
    }
  | {
      outcome: 'none';
      reason: string;
      kind: 'none';
    };

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

function normalizeSuggestionToken(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[`"'([{]+/g, '')
    .replace(/[`"')\]}!?.,;:]+/g, '')
    .replace(/\s+/g, ' ');
}

export function isLowValueAcknowledgementSuggestion(raw: unknown): boolean {
  const token = normalizeSuggestionToken(String(raw ?? ''));
  if (!token) return false;
  return (
    token === 'ok' ||
    token === 'okay' ||
    token === 'kk' ||
    token === 'got it' ||
    token === 'understood' ||
    token === 'noted' ||
    token === 'sounds good' ||
    token === 'looks good' ||
    token === 'makes sense' ||
    token === 'perfect' ||
    token === 'great' ||
    token === 'awesome' ||
    token === 'thanks' ||
    token === 'thank you'
  );
}

export function normalizeAgentSuggestionResult(object: {
  outcome?: unknown;
  suggestion?: unknown;
  reason?: unknown;
  kind?: unknown;
}): AgentSuggestionResult {
  const reason = clip(String(object?.reason ?? ''), 240) || 'No reason provided.';
  const outcome = String(object?.outcome ?? '').trim().toLowerCase() === 'none' ? 'none' : 'suggest';
  if (outcome === 'none') {
    return {
      outcome: 'none',
      reason,
      kind: 'none',
    };
  }

  const suggestion = clip(String(object?.suggestion ?? ''), 1200);
  if (!suggestion) throw new Error('LLM returned an empty suggestion');
  if (isLowValueAcknowledgementSuggestion(suggestion)) {
    return {
      outcome: 'none',
      reason,
      kind: 'none',
    };
  }

  const kindRaw = String(object?.kind ?? '').trim().toLowerCase();
  const kind: Exclude<AgentSuggestionKind, 'none'> =
    kindRaw === 'approval' ||
    kindRaw === 'question' ||
    kindRaw === 'correction' ||
    kindRaw === 'instruction' ||
    kindRaw === 'review' ||
    kindRaw === 'commit' ||
    kindRaw === 'status'
      ? kindRaw
      : 'instruction';

  return {
    outcome: 'suggest',
    suggestion,
    reason,
    kind,
  };
}

export function buildAgentSuggestionSystemPrompt(): string {
  return [
    'You suggest the single most likely next user reply in a developer chat.',
    'Return ONLY the structured output required by the schema.',
    'The reply should follow the policy below, not imitate a generic assistant.',
    'Prefer short, practical replies unless the conversation clearly calls for more detail.',
    'Do not invent new requirements beyond what the current conversation supports.',
    'Sometimes the correct result is no suggestion.',
    'Use outcome="none" when the agent conversation is effectively finished and the only plausible reply would be a low-value acknowledgement like "ok", "sounds good", or "thanks".',
    'Use outcome="none" when you are too uncertain to make a useful suggestion and the user should decide what to say next.',
    'Use outcome="none" when the agent already reports that an action is completed and the candidate reply would only repeat that same action.',
    'For example: if the agent says it already committed or merged the work, do not suggest `commit`.',
    'Do not force a reply just to fill the slot.',
    'If the agent recommendation looks sound and a reply would still move the work forward, prefer a short approval or instruction.',
    'If the agent introduced questionable naming, architecture, abstraction, or hidden behavior, prefer a correction or question.',
    'If the agent likely needs a regression pass, prefer a review-oriented reply.',
    'Use terse operator-style replies when appropriate.',
  ].join('\n');
}

export async function suggestReplyToAgentMessage(
  opts: {
    prompt?: string;
    response: string;
    context?: Array<{ turn: number; prompt: string; response: string }>;
    policyMarkdown: string;
  },
  llm?: { provider?: LlmProviderId; apiKey?: string },
): Promise<AgentSuggestionResult> {
  const response = clip(String(opts?.response ?? ''), 14_000);
  if (!response) throw new Error('missing agent response');

  const policyMarkdown = clip(String(opts?.policyMarkdown ?? ''), 18_000);
  if (!policyMarkdown) throw new Error('missing assistant suggestion policy');

  const runtime = await resolveHubLlmRuntime(llm);
  const modelId = String(process.env.DRONE_HUB_AGENT_SUGGESTION_MODEL ?? '').trim() || defaultModelId(runtime.provider);

  const schema = runtime.z.object({
    outcome: runtime.z
      .enum(['suggest', 'none'])
      .describe(
        'Use "suggest" when a concrete next user reply would be useful. Use "none" when the right outcome is no suggestion.',
      ),
    suggestion: runtime.z
      .string()
      .max(1200)
      .optional()
      .describe('The single most likely next user reply. Leave empty when outcome is "none".'),
    reason: runtime.z
      .string()
      .min(1)
      .max(240)
      .describe('Brief explanation of why this reply should be suggested or suppressed.'),
    kind: runtime.z.enum(['approval', 'question', 'correction', 'instruction', 'review', 'commit', 'status', 'none']),
  });

  const system = buildAgentSuggestionSystemPrompt();

  const ctx = Array.isArray(opts?.context) ? opts.context : [];
  const ctxText =
    ctx.length > 0
      ? ctx
          .slice(-4)
          .map((t) => {
            const turn = typeof (t as any)?.turn === 'number' ? (t as any).turn : null;
            const p = clip(String((t as any)?.prompt ?? ''), 1800);
            const r = clip(String((t as any)?.response ?? ''), 3600);
            return [
              turn != null ? `Turn ${turn}` : 'Turn',
              'User:',
              p || '(empty)',
              '',
              'Agent:',
              r || '(empty)',
            ].join('\n');
          })
          .join('\n\n---\n\n')
      : '';

  const prompt = [
    'Policy markdown:',
    policyMarkdown,
    '',
    ctxText ? 'Recent chat context (most recent last):' : null,
    ctxText || null,
    '',
    'User prompt for the target turn:',
    clip(String(opts?.prompt ?? ''), 5000) || '(empty)',
    '',
    'Target agent response:',
    response,
  ]
    .filter((item) => typeof item === 'string')
    .join('\n');

  let object: any = null;
  try {
    const out = await runtime.generateObject({
      model: runtime.modelFactory(modelId),
      schema,
      system,
      prompt,
      temperature: 0.2,
      maxRetries: 2,
    });
    object = out.object;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    throw new Error(`${providerDisplayName(runtime.provider)} assistant suggestion failed (model: ${modelId}): ${msg}`);
  }

  return normalizeAgentSuggestionResult(object ?? {});
}
