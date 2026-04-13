import type { LlmProviderId } from './hub-settings';
import { DEFAULT_GEMINI_FLASH_MODEL_ID } from './llm-models';

type LlmRuntime = {
  provider: LlmProviderId;
  z: any;
  generateObject: any;
  modelFactory: (modelId: string) => any;
};

export type AgentSuggestionKind =
  | 'approval'
  | 'question'
  | 'correction'
  | 'instruction'
  | 'review'
  | 'commit'
  | 'status';

export type AgentSuggestionResult = {
  suggestion: string;
  reason: string;
  kind: AgentSuggestionKind;
};

function normalizeProvider(raw: unknown): LlmProviderId {
  return String(raw ?? '').trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai';
}

function providerDisplayName(provider: LlmProviderId): string {
  return provider === 'gemini' ? 'Gemini' : 'OpenAI';
}

function defaultModelId(provider: LlmProviderId): string {
  return provider === 'gemini' ? DEFAULT_GEMINI_FLASH_MODEL_ID : 'gpt-4o-mini';
}

async function resolveLlmRuntime(opts?: { provider?: LlmProviderId; apiKey?: string }): Promise<LlmRuntime> {
  const provider = normalizeProvider(opts?.provider);
  const apiKey = String(opts?.apiKey ?? '').trim();
  if (!apiKey) throw new Error(`Missing ${providerDisplayName(provider)} API key. Configure it in Settings.`);

  const [{ generateObject }, { z }] = await Promise.all([import('ai'), import('zod')]);

  if (provider === 'gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const google = createGoogleGenerativeAI({ apiKey });
    return { provider, z, generateObject, modelFactory: google };
  }

  const { createOpenAI } = await import('@ai-sdk/openai');
  const openai = createOpenAI({ apiKey });
  return { provider, z, generateObject, modelFactory: openai };
}

function normalizeNewlines(s: string): string {
  return String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function clip(s: string, maxChars: number): string {
  const text = normalizeNewlines(String(s ?? '')).trim();
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
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

  const runtime = await resolveLlmRuntime(llm);
  const modelId = String(process.env.DRONE_HUB_AGENT_SUGGESTION_MODEL ?? '').trim() || defaultModelId(runtime.provider);

  const schema = runtime.z.object({
    suggestion: runtime.z
      .string()
      .min(1)
      .max(1200)
      .describe('The single most likely next user reply. Keep it concise and natural.'),
    reason: runtime.z
      .string()
      .min(1)
      .max(240)
      .describe('Brief explanation of why this is the likely next reply.'),
    kind: runtime.z.enum(['approval', 'question', 'correction', 'instruction', 'review', 'commit', 'status']),
  });

  const system = [
    'You suggest the single most likely next user reply in a developer chat.',
    'Return ONLY the structured output required by the schema.',
    'The reply should follow the policy below, not imitate a generic assistant.',
    'Prefer short, practical replies unless the conversation clearly calls for more detail.',
    'Do not invent new requirements beyond what the current conversation supports.',
    'If the agent recommendation looks sound, prefer a short approval or instruction.',
    'If the agent introduced questionable naming, architecture, abstraction, or hidden behavior, prefer a correction or question.',
    'If the agent likely needs a regression pass, prefer a review-oriented reply.',
    'Use terse operator-style replies when appropriate.',
  ].join('\n');

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

  const suggestion = clip(String(object?.suggestion ?? ''), 1200);
  if (!suggestion) throw new Error('LLM returned an empty suggestion');

  const kindRaw = String(object?.kind ?? '').trim().toLowerCase();
  const kind: AgentSuggestionKind =
    kindRaw === 'approval' || kindRaw === 'question' || kindRaw === 'correction' || kindRaw === 'instruction' || kindRaw === 'review' || kindRaw === 'commit' || kindRaw === 'status'
      ? kindRaw
      : 'instruction';

  return {
    suggestion,
    reason: clip(String(object?.reason ?? ''), 240) || 'No reason provided.',
    kind,
  };
}
