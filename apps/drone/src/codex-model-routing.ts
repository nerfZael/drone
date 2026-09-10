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
  // OpenRouter handles Codex's built-in web search through its server-tools
  // adapter, which can stall or return provider 429s even for simple greetings.
  return script + ` -c 'web_search="disabled"'` + ` -c 'model_provider="${CODEX_OPENROUTER_PROVIDER}"'` +
    ` -c 'model_providers.${CODEX_OPENROUTER_PROVIDER}={name="OpenRouter",base_url="https://openrouter.ai/api/v1",wire_api="responses",auth={command="printenv",args=["DRONE_CODEX_OPENROUTER_API_KEY"]}}'`;
}

export function assertCodexModelProvider(result: any, provider: string): void {
  if ((result?.modelProvider ?? result?.thread?.modelProvider) !== provider) {
    throw new Error('Codex did not apply the selected provider. Update Codex and retry; the conversation was preserved.');
  }
}

export function codexToolInterfaceContext(selection?: string): Record<string, { kind: 'application'; value: string }> | undefined {
  if (codexModelRoute(selection).provider !== 'openrouter') return undefined;
  // Codex preserves the original model's base instructions on resume. Those can
  // require code-mode tools that the selected OpenRouter model does not expose.
  // Keep this conditional on the actual tool inventory so it also remains valid
  // in retained history after switching back to an OpenAI model.
  const value = `The model and provider can change between turns in this conversation. Earlier instructions and tool calls may describe a tool interface that is no longer available.
For tool names, availability, and argument formats, the current tool definitions take precedence over earlier tool-use instructions and examples in the conversation.
Use functions.exec and its tools.* JavaScript helpers only when exec is exposed in the current tool definitions. Otherwise call the exposed tools directly (for example, exec_command with its JSON arguments); do not wrap calls in JavaScript or invent an exec tool.
If a call returns "unsupported call", consult the current tool definitions and use the available equivalent. A missing exec wrapper does not mean command execution is unavailable.
These instructions concern tool invocation only; all existing permissions, approval requirements, and task constraints still apply.`;
  return { drone_hub_tool_interface: { kind: 'application', value } };
}
