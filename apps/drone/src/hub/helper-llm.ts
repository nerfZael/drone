import { resolveEffectiveProviderApiKeySettings, type LlmProviderId } from './hub-settings';

/** Providers the Hub's small helper calls (next actions, asks) can use; each picks a model from the Hub catalog. */
export const HELPER_LLM_PROVIDERS: readonly LlmProviderId[] = ['openai', 'codex', 'gemini', 'openrouter', 'cerebras'];

export function isHelperLlmProvider(value: unknown): value is LlmProviderId {
  return HELPER_LLM_PROVIDERS.includes(value as LlmProviderId);
}

/** Which helper providers have credentials, for settings pages to warn before calls fail. */
export async function helperLlmCredentials(): Promise<Record<LlmProviderId, boolean>> {
  return Object.fromEntries(await Promise.all(
    HELPER_LLM_PROVIDERS.map(async (provider) => [provider, Boolean((await resolveEffectiveProviderApiKeySettings(provider)).apiKey)] as const),
  )) as Record<LlmProviderId, boolean>;
}

/** Keeps the start and the (usually more relevant) end of an over-long text. */
export function clipMiddle(text: string, max: number): string {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  const head = Math.floor(max / 3);
  return `${value.slice(0, head).trimEnd()}\n…[truncated]…\n${value.slice(value.length - (max - head)).trimStart()}`;
}
