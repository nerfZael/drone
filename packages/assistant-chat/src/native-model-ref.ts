import type { NativeAgentProviderId } from './native-chat-types.js';

/** The Built-in agent's providers, in the order a picker offers them, with the names it shows. */
export const NATIVE_AGENT_PROVIDERS: ReadonlyArray<{ id: NativeAgentProviderId; label: string }> = [
  { id: 'codex', label: 'ChatGPT' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'cerebras', label: 'Cerebras' },
];

export function isNativeAgentProviderId(value: unknown): value is NativeAgentProviderId {
  return NATIVE_AGENT_PROVIDERS.some((provider) => provider.id === value);
}

/**
 * A Built-in model named with its provider, `provider:model`, so that one string carries both wherever a chat's
 * model travels (new chats, card settings, remembered picks). Without a provider it is the bare model.
 */
export function nativeModelRef(provider: string | null | undefined, model: string | null | undefined): string {
  const id = String(model ?? '').trim();
  const prefix = String(provider ?? '').trim().toLowerCase();
  return id && isNativeAgentProviderId(prefix) ? `${prefix}:${id}` : id;
}

/** The provider and model in a Built-in model reference; a bare model, or an unknown prefix, has no provider. */
export function splitNativeModelRef(ref: string | null | undefined): { provider: NativeAgentProviderId | null; model: string } {
  const value = String(ref ?? '').trim();
  const colon = value.indexOf(':');
  const prefix = colon > 0 ? value.slice(0, colon).toLowerCase() : '';
  return isNativeAgentProviderId(prefix) && value.slice(colon + 1)
    ? { provider: prefix, model: value.slice(colon + 1) }
    : { provider: null, model: value };
}
