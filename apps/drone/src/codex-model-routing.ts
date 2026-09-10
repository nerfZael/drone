// Picker IDs include the route so the same model can be offered by both providers.
export const CODEX_OPENROUTER_PREFIX = 'openrouter:';
// Keep managed auth isolated from any user-owned OpenRouter provider configuration.
export const CODEX_OPENROUTER_PROVIDER = 'drone_hub_openrouter';

export function codexModelRoute(selection?: string): { provider: 'openrouter' | 'default'; model?: string } {
  if (typeof selection === 'string' && selection.startsWith(CODEX_OPENROUTER_PREFIX)) {
    const model = selection.slice(CODEX_OPENROUTER_PREFIX.length).trim();
    if (!model) throw new Error('Select an OpenRouter model.');
    return { provider: 'openrouter', model };
  }
  return { provider: 'default', model: selection || undefined };
}

export function codexProviderLaunchScript(script: string, selection?: string): string {
  if (codexModelRoute(selection).provider !== 'openrouter') return script;
  // Only fixed, non-secret configuration is appended to the managed launch command.
  return script + ` -c 'model_provider="${CODEX_OPENROUTER_PROVIDER}"'` +
    ` -c 'model_providers.${CODEX_OPENROUTER_PROVIDER}={name="OpenRouter",base_url="https://openrouter.ai/api/v1",wire_api="responses",auth={command="printenv",args=["DRONE_CODEX_OPENROUTER_API_KEY"]}}'`;
}

export function assertCodexModelProvider(result: any, provider: string): void {
  if ((result?.modelProvider ?? result?.thread?.modelProvider) !== provider) {
    throw new Error('Codex did not apply the selected provider. Update Codex and retry; the conversation was preserved.');
  }
}
