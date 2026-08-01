import type { LlmProviderId } from './hub-settings';
import { defaultHubLlmModelId, providerDisplayName, resolveHubLlmRuntime } from './llm-runtime';

export const DEFAULT_DRONE_NAME_MODEL_ID = 'gpt-5.6-luna';
export const AUTO_RENAME_NAME_SUGGESTION_RETRY_DELAYS_MS = [5_000, 10_000] as const;

type NameSuggestionRetryOptions = {
  retryDelaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
  onRetry?: (details: { attempt: number; delayMs: number; error: unknown }) => void;
};

function errorChainText(error: unknown): string {
  const values: string[] = [];
  let current = error;
  let depth = 0;
  while (current && depth < 4) {
    if (current instanceof Error) {
      values.push(current.name, current.message, String((current as Error & { code?: unknown }).code ?? ''));
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      values.push(String(current));
      break;
    }
    depth += 1;
  }
  return values.join(' ');
}

export function isTemporaryNameSuggestionFailure(error: unknown): boolean {
  return /\b(fetch failed|network error|terminated|econnreset|etimedout|enotfound|eai_again|und_err_(?:connect_timeout|headers_timeout|body_timeout|socket)|429|502|503|504)\b|connection reset|socket hang up|timed out|rate limit|temporarily unavailable|service unavailable|overloaded|internal server error/i.test(
    errorChainText(error),
  );
}

function waitForNameSuggestionRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function retryTemporaryNameSuggestion<T>(
  request: () => Promise<T>,
  options: NameSuggestionRetryOptions = {},
): Promise<T> {
  const retryDelaysMs = options.retryDelaysMs ?? AUTO_RENAME_NAME_SUGGESTION_RETRY_DELAYS_MS;
  const wait = options.wait ?? waitForNameSuggestionRetry;
  let attempt = 1;
  while (true) {
    try {
      return await request();
    } catch (error) {
      const delayMs = retryDelaysMs[attempt - 1];
      if (delayMs === undefined || !isTemporaryNameSuggestionFailure(error)) throw error;
      options.onRetry?.({ attempt, delayMs, error });
      await wait(delayMs);
      attempt += 1;
    }
  }
}

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
