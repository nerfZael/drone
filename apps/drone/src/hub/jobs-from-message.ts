export type JobSpec = {
  name: string;
  title: string;
  details: string;
};

export type JobsPlan = {
  group: string;
  jobs: JobSpec[];
};

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

function defaultJobsModelId(provider: LlmProviderId): string {
  return provider === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash';
}

function defaultDroneNameModelId(provider: LlmProviderId): string {
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

function toDashCase(raw: string): string {
  const s = String(raw ?? '').trim().toLowerCase();
  const cleaned = s
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 48);
}

function coerceTitle(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // Keep it reasonably compact for UI cards.
  return s.length > 800 ? `${s.slice(0, 800).trimEnd()}…` : s;
}

function coerceDetails(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return s.length > 8000 ? `${s.slice(0, 8000).trimEnd()}…` : s;
}

function coerceGroup(raw: string): string {
  const s = toDashCase(String(raw ?? ''));
  if (!s) return '';
  // Keep groups short-ish so UI stays tidy.
  return s.slice(0, 32);
}

function normalizeNewlines(s: string): string {
  return String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function countNumberedItemStarts(text: string): number {
  const m = normalizeNewlines(text).match(/^\s*\d+\s*[\)\.\:]\s+/gm);
  return m ? m.length : 0;
}

function isVerbatimSubstring(details: string, fullText: string): boolean {
  const needle = normalizeNewlines(details).trim();
  if (!needle) return false;
  const hay = normalizeNewlines(fullText);
  return hay.includes(needle);
}

function looksTooBroadDetails(details: string, fullText: string): boolean {
  const d = String(details ?? '').trim();
  if (!d) return true;
  const full = String(fullText ?? '');
  if (full && d.length >= Math.floor(full.length * 0.65)) return true;
  if (countNumberedItemStarts(d) > 1) return true;
  // If it contains many Task/Acceptance markers, it's probably multiple jobs.
  const taskMarkers = (normalizeNewlines(d).match(/(^|\n)\s*Task\s*:/gi) ?? []).length;
  const acceptanceMarkers = (normalizeNewlines(d).match(/(^|\n)\s*Acceptance\s*:/gi) ?? []).length;
  if (taskMarkers > 1 || acceptanceMarkers > 1) return true;
  return false;
}

async function refineJobDetails(opts: {
  modelFactory: (modelId: string) => any;
  modelId: string;
  z: any;
  generateObject: any;
  message: string;
  job: { name: string; title: string };
  attempt: number;
  priorDetails: string;
}): Promise<string> {
  const schema = opts.z.object({
    details: opts.z
      .string()
      .min(1)
      .describe('A verbatim excerpt copied from the message that contains ONLY the details for this job.'),
  });

  const system = [
    'You extract per-job details from a message.',
    'Return ONLY the structured output required by the schema.',
    'CRITICAL:',
    '- The returned details MUST be a verbatim excerpt (copy/paste) from the message.',
    '- Do not paraphrase.',
    '- Do not include details belonging to other jobs.',
    "- If the message contains a numbered list of tasks, your details must include at most ONE numbered item start like '1)' or '2)'.",
    opts.attempt > 1 ? '- Be more aggressive about trimming unrelated parts.' : null,
  ]
    .filter(Boolean)
    .join('\n');

  const msg = normalizeNewlines(opts.message);
  const numbered = msg
    .split('\n')
    .map((l, i) => `${i + 1}|${l}`)
    .join('\n');

  const prompt = [
    `Job name: ${opts.job.name}`,
    `Job title: ${opts.job.title}`,
    '',
    'Message with line numbers (format: "LINE|text"). Copy your details from here WITHOUT the "LINE|" prefixes:',
    '',
    numbered,
    '',
    'Previous (too-broad) details (for reference; you must return a narrower verbatim excerpt from the message):',
    '',
    normalizeNewlines(opts.priorDetails).slice(0, 4000),
  ].join('\n');

  const { object } = await opts.generateObject({
    model: opts.modelFactory(opts.modelId),
    schema,
    system,
    prompt,
    temperature: 0,
    maxRetries: 1,
  });

  return coerceDetails(String((object as any)?.details ?? ''));
}

export async function jobsPlanFromAgentMessage(
  message: string,
  opts?: { provider?: LlmProviderId; apiKey?: string },
): Promise<JobsPlan> {
  const text = String(message ?? '').trim();
  if (!text) throw new Error('missing message');

  const msg = normalizeNewlines(text);
  const numbered = msg
    .split('\n')
    .map((l, i) => `${i + 1}|${l}`)
    .join('\n');

  const runtime = await resolveLlmRuntime(opts);
  const modelId = String(process.env.DRONE_HUB_JOBS_MODEL ?? '').trim() || defaultJobsModelId(runtime.provider);

  const outputSchema = runtime.z.object({
    group: runtime.z
      .string()
      .min(1)
      .describe(
        'A dash-case group name to use for all jobs (used to organize drones). Keep it short and descriptive (e.g. "auth", "billing", "frontend-polish").',
      ),
    jobs: runtime.z.array(
      runtime.z.object({
        name: runtime.z
          .string()
          .min(1)
          .describe('A short dash-case identifier. Must be suitable as a docker container / drone name (e.g. "setup-db", "fix-auth-bug").'),
        title: runtime.z.string().min(1).describe('A one-line title describing the job (short and clear).'),
        details: runtime.z
          .string()
          .min(1)
          .describe(
            'A VERBATIM excerpt copied from the message that contains ONLY the details/instructions for this job (no other jobs). Do not paraphrase.',
          ),
      }),
    ),
  });

  const system = [
    'You are a task parser.',
    'Given an agent message, extract 1-8 actionable jobs.',
    'Return only the structured output required by the schema.',
    'Also create a single group name to apply to all jobs (dash-case).',
    'Each job name must be dash-case and should be a good drone name.',
    'Avoid overly generic names like "task-1". Prefer meaningful names.',
    'Do NOT invent details. All details must come from the message.',
    'CRITICAL: details must be a verbatim excerpt from the message (copy/paste). Do not paraphrase.',
    'CRITICAL: details must not include other jobs.',
    "If the message contains a numbered list of tasks, each job's details should include at most ONE numbered item start like '1)' or '2)'.",
  ].join('\n');

  const { object } = await runtime.generateObject({
    model: runtime.modelFactory(modelId),
    schema: outputSchema,
    system,
    prompt:
      `Agent message with line numbers (format: "LINE|text"):\n\n${numbered}\n\n` +
      'Return jobs in the same order they appear in the message. For details: copy/paste from the message, but do not include the "LINE|" prefixes.',
    temperature: 0.2,
    maxRetries: 2,
  });

  const group = coerceGroup((object as any)?.group ?? '');
  const list: Array<{ name?: unknown; title?: unknown; details?: unknown }> = Array.isArray((object as any)?.jobs)
    ? ((object as any).jobs as any[])
    : [];

  const used = new Set<string>();
  const out: JobSpec[] = [];

  for (let i = 0; i < list.length && out.length < 12; i++) {
    const raw = list[i] ?? {};
    const baseName = toDashCase(String((raw as any).name ?? ''));
    const title = coerceTitle(String((raw as any).title ?? ''));
    if (!title) continue;

    let detailsJoined = coerceDetails(String((raw as any).details ?? ''));

    // If details isn't a substring (not verbatim) or it includes multiple jobs, ask the LLM to refine.
    if (!isVerbatimSubstring(detailsJoined, msg) || looksTooBroadDetails(detailsJoined, msg)) {
      const jobNameForPrompt = baseName || `job-${i + 1}`;
      const job = { name: jobNameForPrompt, title };
      let refined = detailsJoined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          // eslint-disable-next-line no-await-in-loop
          refined = await refineJobDetails({
            modelFactory: runtime.modelFactory,
            modelId,
            z: runtime.z,
            generateObject: runtime.generateObject,
            message: msg,
            job,
            attempt,
            priorDetails: refined || msg,
          });
        } catch {
          // ignore; keep prior
        }
        if (isVerbatimSubstring(refined, msg) && !looksTooBroadDetails(refined, msg)) break;
      }
      detailsJoined = refined;
    }

    // Final fallback: keep something rather than empty.
    if (!detailsJoined) detailsJoined = coerceDetails(msg.length > 1400 ? `${msg.slice(0, 1400).trimEnd()}…` : msg);

    let name = baseName || `job-${i + 1}`;
    if (!name) name = 'job';

    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name}-${n}`)) n++;
      name = `${name}-${n}`;
    }

    used.add(name);
    out.push({ name, title, details: detailsJoined });
  }

  if (out.length === 0) throw new Error('LLM returned no valid jobs');
  return { group: group || 'jobs', jobs: out };
}

export async function suggestDroneNameFromMessage(
  message: string,
  opts?: { provider?: LlmProviderId; apiKey?: string },
): Promise<string> {
  const text = String(message ?? '').trim();
  if (!text) throw new Error('missing message');

  const runtime = await resolveLlmRuntime(opts);
  const modelId = String(process.env.DRONE_HUB_DRONE_NAME_MODEL ?? '').trim() || defaultDroneNameModelId(runtime.provider);
  const outputSchema = runtime.z.object({
    name: runtime.z.string().min(1).describe('Drone name in dash-case (letters/numbers/single hyphens), max 48 chars.'),
  });

  const system = [
    'You generate concise drone names.',
    'Return only the structured output required by the schema.',
    'Rules:',
    '- The name must be dash-case.',
    '- Use only lowercase letters, numbers, and single hyphens.',
    '- Keep it short and specific to the task in the message.',
    '- Max length 48 characters.',
    '- Do not include filler words like "please", "help", or "task".',
  ].join('\n');

  let object: any = null;
  try {
    const out = await runtime.generateObject({
      model: runtime.modelFactory(modelId),
      schema: outputSchema,
      system,
      prompt: `Message:\n${text}`,
      temperature: 0.2,
      maxRetries: 1,
    });
    object = out.object;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    throw new Error(`${providerDisplayName(runtime.provider)} name suggestion failed (model: ${modelId}): ${msg}`);
  }

  const name = toDashCase(String(object?.name ?? ''));
  if (!name) throw new Error('LLM returned no valid drone name');
  return name.slice(0, 48).replace(/-+$/g, '');
}

export async function jobsFromAgentMessage(message: string): Promise<JobSpec[]> {
  const r = await jobsPlanFromAgentMessage(message);
  return r.jobs;
}
