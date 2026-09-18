import { applyBrainOutput, reflexCompilePrompt, validateReflexTable, type ReflexActionSpec, type ReflexBrainOutput, type ReflexCompileInput, type ReflexTable } from '@drone/reflex';
import { readCompanionSettings } from '../companion/companion-config';
import { resolveEffectiveProviderApiKeySettings, type LlmProviderId } from '../hub-settings';
import { providerDisplayName, resolveHubLlmRuntime, type HubLlmRuntime } from '../llm-runtime';

export const REFLEX_COMPILE_MAX_CHARS = 200_000;

/** Bounds and reconstructs the compile request from allowlisted fields only. */
export function parseReflexCompileInput(value: unknown): ReflexCompileInput {
  const input = value as Partial<ReflexCompileInput> | null;
  if (!input || typeof input !== 'object') throw new Error('Provide purpose, stateDescription, actions, and base.');
  const text = (field: unknown, max: number) => (typeof field === 'string' && field.trim() && field.length <= max ? field : null);
  const purpose = text(input.purpose, 8_000);
  const stateDescription = text(input.stateDescription, 16_000);
  if (!purpose || !stateDescription) throw new Error('Purpose and stateDescription must be 1–16000 characters.');
  if (!Array.isArray(input.actions) || !input.actions.length || input.actions.length > 64) throw new Error('Provide 1–64 actions.');
  const actions: ReflexActionSpec[] = input.actions.map(action => {
    const name = text(action?.name, 100); const description = text(action?.description, 2_000);
    if (!name || !description) throw new Error('Every action needs a name and description.');
    return { name, description };
  });
  const errors = validateReflexTable(input.base, actions.map(action => action.name));
  if (errors.length) throw new Error(`Invalid base table: ${errors.join('; ')}`);
  const base = input.base as ReflexTable;
  const observations = input.observations === undefined ? undefined : text(input.observations, 32_000);
  const guidance = input.guidance === undefined ? undefined : text(input.guidance, 16_000);
  if ((input.observations !== undefined && observations === null) || (input.guidance !== undefined && guidance === null)) throw new Error('Observations and guidance must be 1–32000 characters when provided.');
  const result: ReflexCompileInput = { purpose, stateDescription, actions, base, ...(observations ? { observations } : {}), ...(guidance ? { guidance } : {}) };
  if (JSON.stringify(result).length > REFLEX_COMPILE_MAX_CHARS) throw new Error(`The compile request exceeds ${REFLEX_COMPILE_MAX_CHARS} characters.`);
  return result;
}

function brainOutputSchema(z: HubLlmRuntime['z'], questionType: 'boolean' | 'choice' | 'score') {
  const criteriaText = z.string().min(1).max(4_000);
  const question = questionType === 'choice'
    ? z.object({ type: z.literal('choice'), instructions: z.string().min(1).max(16_000), criteria: z.record(z.string(), criteriaText) })
    : questionType === 'score'
      ? z.object({ type: z.literal('score'), instructions: z.string().min(1).max(16_000), criteria: z.array(criteriaText).min(2) })
      : z.object({ type: z.literal('boolean'), instructions: z.string().min(1).max(16_000), criteria: z.object({ true: criteriaText, false: criteriaText }).optional() });
  return question;
}

export function reflexBrainOutputSchema(z: HubLlmRuntime['z'], actions: string[]) {
  const question = z.discriminatedUnion('type', [brainOutputSchema(z, 'choice'), brainOutputSchema(z, 'score'), brainOutputSchema(z, 'boolean')]);
  const leaf = z.object({
    question: z.string().min(1).describe('Question id this condition reads.'),
    is: z.string().optional().describe('Option name for a choice question, or true/false for a boolean.'),
    minProbability: z.number().min(0).max(1).optional().describe('Required probability of `is`.'),
    atLeast: z.number().optional().describe('Lower bound on a boolean probability or score.'),
    atMost: z.number().optional().describe('Upper bound on a boolean probability or score.'),
  });
  return z.object({
    preamble: z.string().max(16_000).optional().describe('Description of the state fields, prepended to every question.'),
    questions: z.record(z.string(), question).describe('Atomic questions the evaluator answers every tick.'),
    expectations: z.record(z.string(), z.object({ instructions: z.string().min(1).max(16_000), criteria: z.object({ true: criteriaTextFor(z), false: criteriaTextFor(z) }).optional(), threshold: z.number().min(0).max(1) })).optional()
      .describe('Boolean checks that should hold; falling below the threshold wakes the brain.'),
    rules: z.array(z.object({
      id: z.string().min(1).max(100),
      description: z.string().max(1_000).optional(),
      when: z.array(leaf).describe('ANDed leaf conditions. Empty means always; only the last rule may be empty.'),
      do: z.enum(actions as [string, ...string[]]),
      wake: z.string().max(200).optional().describe('Also wake the brain with this reason when the rule fires.'),
    })).min(1),
    notes: z.string().max(4_000).optional(),
  });
}

const criteriaTextFor = (z: HubLlmRuntime['z']) => z.string().min(1).max(4_000);

function normalizeLeaf(leaf: { question: string; is?: string; minProbability?: number; atLeast?: number; atMost?: number }) {
  if (leaf.is !== undefined) return { question: leaf.question, is: leaf.is, ...(leaf.minProbability !== undefined ? { minProbability: leaf.minProbability } : {}) };
  if (leaf.atLeast !== undefined) return { question: leaf.question, atLeast: leaf.atLeast };
  if (leaf.atMost !== undefined) return { question: leaf.question, atMost: leaf.atMost };
  throw new Error(`Condition on ${leaf.question} needs is, atLeast, or atMost.`);
}

type CompileDependencies = {
  settings(): Promise<{ provider: LlmProviderId; model: string }>;
  credential(provider: LlmProviderId): Promise<{ apiKey: string | null }>;
  runtime(options: { provider: LlmProviderId; apiKey: string }): Promise<HubLlmRuntime>;
};

/** The brain: revise a reflex table with the Companion helper model. Returns a validated, versioned table. */
export async function compileReflexTable(input: ReflexCompileInput, overrides: Partial<CompileDependencies> = {}): Promise<{ table: ReflexTable; output: ReflexBrainOutput; model: string; provider: LlmProviderId; durationMs: number }> {
  const deps: CompileDependencies = {
    settings: async () => { const settings = await readCompanionSettings(); return { provider: settings.provider, model: settings.model }; },
    credential: resolveEffectiveProviderApiKeySettings,
    runtime: resolveHubLlmRuntime,
    ...overrides,
  };
  const settings = await deps.settings();
  const credential = await deps.credential(settings.provider);
  if (!credential.apiKey) throw new Error(`Configure ${providerDisplayName(settings.provider)} credentials in Settings before the brain can compile reflex tables.`);
  const runtime = await deps.runtime({ provider: settings.provider, apiKey: credential.apiKey });
  const actions = input.actions.map(action => action.name);
  const { system, prompt } = reflexCompilePrompt(input);
  const startedAt = Date.now();
  let raw: any;
  try {
    raw = (await runtime.generateObject({ model: runtime.modelFactory(settings.model), schema: reflexBrainOutputSchema(runtime.z, actions), system, prompt, maxRetries: 1, reasoning: 'low' })).object;
  } catch (error) {
    throw new Error(`${providerDisplayName(settings.provider)} could not compile the reflex table (model: ${settings.model}): ${error instanceof Error ? error.message : String(error)}`);
  }
  const output: ReflexBrainOutput = {
    ...(raw.preamble !== undefined ? { preamble: raw.preamble } : {}),
    questions: raw.questions,
    ...(raw.expectations !== undefined ? { expectations: raw.expectations } : {}),
    rules: raw.rules.map((rule: any) => ({ id: rule.id, do: rule.do, when: (rule.when ?? []).map(normalizeLeaf), ...(rule.wake ? { wake: rule.wake } : {}), ...(rule.description ? { description: rule.description } : {}) })),
    ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
  };
  const table = applyBrainOutput(input.base, output, { actions });
  return { table, output, model: settings.model, provider: settings.provider, durationMs: Date.now() - startedAt };
}
