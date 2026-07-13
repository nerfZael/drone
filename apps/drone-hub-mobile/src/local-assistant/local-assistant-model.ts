export const DEFAULT_LOCAL_ASSISTANT_MODEL = 'gpt-5.6-sol';
export type LocalAssistantThinkingLevel = 'off' | 'low' | 'medium' | 'high';
export const DEFAULT_LOCAL_ASSISTANT_THINKING_LEVEL: LocalAssistantThinkingLevel = 'low';

export const LOCAL_ASSISTANT_MODEL_OPTIONS = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
] as const;

export function localAssistantModelOptions(provider: 'openai' | 'codex') {
  return LOCAL_ASSISTANT_MODEL_OPTIONS.map((option) => ({ provider, ...option }));
}

export function normalizeLocalAssistantThinkingLevel(value: unknown): LocalAssistantThinkingLevel {
  return value === 'off' || value === 'medium' || value === 'high' ? value : 'low';
}

export function migrateLocalAssistantModel(value: unknown): string {
  const model = String(value ?? '')
    .trim()
    .slice(0, 100);
  if (!model) return DEFAULT_LOCAL_ASSISTANT_MODEL;
  return model;
}
