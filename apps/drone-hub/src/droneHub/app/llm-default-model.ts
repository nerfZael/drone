import type { NativeAgentDefaultModel, NativeAgentModelOption } from '@drone/assistant-chat';
import type { LlmProviderId } from './settings-types';

export type LlmDefaultModelChoice = {
  id: string;
  label: string;
  reasoningLevels: string[];
};

export type LlmDefaultModelDraft = {
  provider: LlmProviderId;
  model: string;
  thinkingLevel: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function llmDefaultModelChoices(
  models: readonly NativeAgentModelOption[],
  provider: LlmProviderId,
): LlmDefaultModelChoice[] {
  const choices = new Map<string, LlmDefaultModelChoice>();
  for (const option of models) {
    if (option.provider !== provider) continue;
    const id = text(option.id);
    if (!id) continue;
    const thinkingLevel = text(option.thinkingLevel) || 'off';
    const existing = choices.get(id);
    if (existing) {
      if (!existing.reasoningLevels.includes(thinkingLevel)) {
        existing.reasoningLevels.push(thinkingLevel);
      }
      continue;
    }
    choices.set(id, {
      id,
      label: text(option.name) || id,
      reasoningLevels: [thinkingLevel],
    });
  }
  return [...choices.values()];
}

export function resolveLlmDefaultModelDraft(
  models: readonly NativeAgentModelOption[],
  provider: LlmProviderId,
  configured?: NativeAgentDefaultModel | null,
): LlmDefaultModelDraft {
  const choices = llmDefaultModelChoices(models, provider);
  const configuredModel =
    configured?.provider === provider
      ? choices.find((choice) => choice.id === text(configured.model))
      : undefined;
  const selected = configuredModel ?? choices[0];
  const configuredThinkingLevel =
    configured?.provider === provider ? text(configured.thinkingLevel) : '';
  return {
    provider,
    model: selected?.id ?? '',
    thinkingLevel:
      selected?.reasoningLevels.includes(configuredThinkingLevel)
        ? configuredThinkingLevel
        : selected?.reasoningLevels[0] ?? '',
  };
}

export function selectLlmDefaultModel(
  models: readonly NativeAgentModelOption[],
  draft: LlmDefaultModelDraft,
  model: string,
): LlmDefaultModelDraft {
  const selected = llmDefaultModelChoices(models, draft.provider).find(
    (choice) => choice.id === text(model),
  );
  if (!selected) return draft;
  return {
    ...draft,
    model: selected.id,
    thinkingLevel: selected.reasoningLevels.includes(draft.thinkingLevel)
      ? draft.thinkingLevel
      : selected.reasoningLevels[0] ?? '',
  };
}
