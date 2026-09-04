import type { NativeAgentThinkingLevel } from '@drone/assistant-chat';

import type { LlmProviderId } from './hub-settings';

export type HubAgentModelOption = {
  provider: LlmProviderId;
  id: string;
  name: string;
  thinkingLevel: NativeAgentThinkingLevel;
};

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
export const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';

const STANDARD_REASONING_LEVELS: NativeAgentThinkingLevel[] = ['off', 'low', 'medium', 'high'];
const GEMINI_FLASH_LITE_REASONING_LEVELS: NativeAgentThinkingLevel[] = [
  'minimal',
  'medium',
  'high',
];

function modelOptions(
  provider: LlmProviderId,
  id: string,
  name: string,
  levels: NativeAgentThinkingLevel[] = STANDARD_REASONING_LEVELS,
): HubAgentModelOption[] {
  return levels.map((thinkingLevel) => ({ provider, id, name, thinkingLevel }));
}

export const HUB_AGENT_MODEL_OPTIONS: HubAgentModelOption[] = [
  ...modelOptions('openai', 'gpt-5.6-sol', 'GPT-5.6 Sol'),
  ...modelOptions('openai', 'gpt-5.6-terra', 'GPT-5.6 Terra'),
  ...modelOptions('openai', 'gpt-5.6-luna', 'GPT-5.6 Luna'),
  ...modelOptions('openai', 'gpt-5.5', 'GPT-5.5'),
  ...modelOptions('codex', 'gpt-5.6-sol', 'GPT-5.6 Sol'),
  ...modelOptions('codex', 'gpt-5.6-terra', 'GPT-5.6 Terra'),
  ...modelOptions('codex', 'gpt-5.6-luna', 'GPT-5.6 Luna'),
  ...modelOptions('codex', 'gpt-5.5', 'GPT-5.5'),
  ...modelOptions('openrouter', 'openrouter/auto', 'OpenRouter Auto'),
  ...modelOptions('openrouter', 'anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6'),
  ...modelOptions('openrouter', 'openai/gpt-5', 'GPT-5'),
  ...modelOptions('openrouter', 'google/gemini-3-flash-preview', 'Gemini 3 Flash'),
  ...modelOptions(
    'gemini',
    'gemini-3.5-flash-lite',
    'Gemini 3.5 Flash-Lite',
    GEMINI_FLASH_LITE_REASONING_LEVELS,
  ),
  ...modelOptions('gemini', 'gemini-3-flash-preview', 'Gemini 3 Flash', ['medium']),
];
