import { COMPANION_INSTRUCTIONS_MAX_CHARS } from '@drone/assistant-chat';
import { COMPANION_SYSTEM_PROMPT_MAX_CHARS, COMPANION_TOOL_SUMMARIES, DEFAULT_COMPANION_SYSTEM_PROMPT, readCompanionSettings, writeCompanionSettings } from '../companion/companion-config';
import { readCompanionInstructions, writeCompanionInstructions } from '../companion/companion-instructions';

/** These operations have separate mesh grants from model selection and running Companion. */
export async function companionBehaviorSettings(operation: string, payload: Record<string, unknown>) {
  if (operation === 'instructions.get' || operation === 'instructions.update') {
    const instructions = operation === 'instructions.update'
      ? await writeCompanionInstructions(payload.content, payload.revision) : await readCompanionInstructions();
    return { instructions, maxChars: COMPANION_INSTRUCTIONS_MAX_CHARS };
  }
  const current = await readCompanionSettings();
  if (operation === 'behavior.settings.update') {
    if (payload.promptDeliveryMode !== undefined && payload.promptDeliveryMode !== 'asap' && payload.promptDeliveryMode !== 'queue') throw new Error('Choose ASAP or Queue follow-up delivery.');
    // Apply only fields edited on the phone, preserving model selection and other settings.
    const update = Object.fromEntries(['promptDeliveryMode', 'systemPrompt', 'enabledTools']
      .filter(key => payload[key] !== undefined).map(key => [key, payload[key]]));
    await writeCompanionSettings({ ...current, ...update });
  }
  const settings = await readCompanionSettings();
  return {
    settings: { promptDeliveryMode: settings.promptDeliveryMode, systemPrompt: settings.systemPrompt, enabledTools: settings.enabledTools },
    tools: COMPANION_TOOL_SUMMARIES, defaultSystemPrompt: DEFAULT_COMPANION_SYSTEM_PROMPT,
    maxSystemPromptChars: COMPANION_SYSTEM_PROMPT_MAX_CHARS,
  };
}
