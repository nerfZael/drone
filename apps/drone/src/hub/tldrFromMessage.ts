export type LlmProviderId = 'openai' | 'gemini';

type LlmRuntime = {
  provider: LlmProviderId;
  z: any;
  generateObject: any;
  modelFactory: (modelId: string) => any;
};

function normalizeProvider(raw: unknown): LlmProviderId {
  return String(raw ?? '').trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai';
}

function providerDisplayName(provider: LlmProviderId): string {
  return provider === 'openai' ? 'OpenAI' : 'Gemini';
}

function defaultTldrModelId(provider: LlmProviderId): string {
  return provider === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash';
}

async function resolveLlmRuntime(opts?: { provider?: LlmProviderId; apiKey?: string }): Promise<LlmRuntime> {
  const provider = normalizeProvider(opts?.provider);
  const apiKey = String(opts?.apiKey ?? '').trim();
  if (!apiKey) throw new Error(`Missing ${providerDisplayName(provider)} API key. Configure it in Settings.`);

  // Dynamic imports keep this file compatible with the existing CommonJS build.
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

export async function tldrFromAgentMessage(
  opts: {
    prompt?: string;
    response: string;
    context?: Array<{ turn: number; prompt: string; response: string }>;
  },
  llm?: { provider?: LlmProviderId; apiKey?: string },
): Promise<string> {
  const response = String(opts?.response ?? '').trim();
  if (!response) throw new Error('missing response');

  const runtime = await resolveLlmRuntime(llm);
  const modelId = String(process.env.DRONE_HUB_TLDR_MODEL ?? '').trim() || defaultTldrModelId(runtime.provider);

  const schema = runtime.z.object({
    tldr: runtime.z
      .string()
      .min(1)
      .describe(
        'A short Markdown TLDR for the agent response. Prefer 3-8 bullets. Include concrete actions/outcomes, errors, and next steps.',
      ),
  });

  const system = [
    'You write TLDR summaries for an agent message in a developer chat UI.',
    'Return ONLY the structured output required by the schema.',
    'Rules:',
    '- Output must be Markdown.',
    '- Prefer 3-8 concise bullets.',
    '- Focus on what the agent did/answered: key decisions, actions, outcomes, errors, and next steps.',
    '- Mention important commands, file paths, or APIs as inline code when relevant.',
    '- Do NOT copy large chunks verbatim from the response.',
    '- No preamble, no headings unless truly necessary.',
  ].join('\n');

  const ctx = Array.isArray(opts?.context) ? opts.context : [];
  const ctxText =
    ctx.length > 0
      ? ctx
          .slice(-4)
          .map((t) => {
            const turn = typeof (t as any)?.turn === 'number' ? (t as any).turn : null;
            const p = clip(String((t as any)?.prompt ?? ''), 2000);
            const r = clip(String((t as any)?.response ?? ''), 5000);
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
    ctxText ? 'Recent chat context (most recent last):' : null,
    ctxText || null,
    ctxText ? '\n\nNow summarize the TARGET agent response below.' : null,
    '',
    'User prompt (for this turn):',
    clip(String(opts?.prompt ?? ''), 6000) || '(empty)',
    '',
    'TARGET agent response:',
    clip(response, 14_000),
  ]
    .filter((x) => typeof x === 'string')
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
    throw new Error(`${providerDisplayName(runtime.provider)} TLDR generation failed (model: ${modelId}): ${msg}`);
  }

  const tldr = clip(String(object?.tldr ?? ''), 4000);
  if (!tldr) throw new Error('LLM returned an empty TLDR');
  return tldr;
}

