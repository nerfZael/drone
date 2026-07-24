import type { LlmProviderId } from './hub-settings';
import { defaultHubLlmModelId, providerDisplayName, resolveHubLlmRuntime } from './llm-runtime';

export const DEFAULT_DRONE_NAME_MODEL_ID = 'gpt-5.6-luna';

function defaultDroneNameModelId(provider: LlmProviderId): string {
  return provider === 'gemini'
    ? defaultHubLlmModelId(provider, 'standard')
    : DEFAULT_DRONE_NAME_MODEL_ID;
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

function toDisplayName(raw: string): string {
  const compact = String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (!compact) return '';
  const bounded = compact.slice(0, 48).trim();
  return `${bounded.charAt(0).toUpperCase()}${bounded.slice(1)}`;
}

export async function suggestDroneNameFromMessage(
  message: string,
  opts?: { provider?: LlmProviderId; apiKey?: string; style?: 'display' | 'identifier' },
): Promise<string> {
  const text = String(message ?? '').trim();
  if (!text) throw new Error('missing message');

  const runtime = await resolveHubLlmRuntime(opts);
  const modelId = defaultDroneNameModelId(runtime.provider);
  const identifierStyle = opts?.style === 'identifier';
  const outputSchema = runtime.z.object({
    name: runtime.z.string().min(1).describe(
      identifierStyle
        ? 'Drone identifier in dash-case (letters/numbers/single hyphens), max 48 chars.'
        : 'Concise display name, normally using spaces and an uppercase first letter, max 48 chars.',
    ),
  });

  const system = identifierStyle
    ? [
        'You generate concise drone identifiers.',
        'Return only the structured output required by the schema.',
        'Rules:',
        '- The identifier must be dash-case.',
        '- Use only lowercase letters, numbers, and single hyphens.',
        '- Keep it short and specific to the task in the message.',
        '- Max length 48 characters.',
        '- Do not include filler words like "please", "help", or "task".',
      ].join('\n')
    : [
        'You generate concise display names for drones and chats.',
        'Return only the structured output required by the schema.',
        'Rules:',
        '- Prefer a natural name with spaces and an uppercase first letter, such as "Fix login loop".',
        '- Hyphens are allowed when they are a natural part of the name, but do not default to dash-case.',
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
      maxRetries: 1,
      reasoning: 'none',
      ...(runtime.provider === 'openai'
        ? { providerOptions: { openai: { reasoningEffort: 'none' } } }
        : {}),
    });
    object = out.object;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    throw new Error(
      `${providerDisplayName(runtime.provider)} name suggestion failed (model: ${modelId}): ${msg}`,
    );
  }

  const name = identifierStyle
    ? toDashCase(String(object?.name ?? ''))
    : toDisplayName(String(object?.name ?? ''));
  if (!name) throw new Error('LLM returned no valid drone name');
  return identifierStyle ? name.slice(0, 48).replace(/-+$/g, '') : name;
}
