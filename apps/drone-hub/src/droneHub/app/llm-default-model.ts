import {
  groupProviderModelOptions,
  resolveModelCatalogSelection,
  selectModelCatalogModel,
  type ModelCatalogModel,
  type NativeAgentDefaultModel,
  type NativeAgentModelOption,
} from '@drone/assistant-chat';
import type { LlmProviderId } from './settings-types';

export type LlmDefaultModelChoice = ModelCatalogModel;

export type LlmDefaultModelDraft = {
  provider: LlmProviderId;
  model: string;
  thinkingLevel: string;
};

export function llmDefaultModelChoices(
  models: readonly NativeAgentModelOption[],
  provider: LlmProviderId,
): LlmDefaultModelChoice[] {
  return providerModelChoices(models, provider);
}

export function resolveLlmDefaultModelDraft(
  models: readonly NativeAgentModelOption[],
  provider: LlmProviderId,
  configured?: NativeAgentDefaultModel | null,
): LlmDefaultModelDraft {
  const choices = providerModelChoices(models, provider, configured);
  const selection = resolveModelCatalogSelection(
    choices,
    configured?.provider === provider ? configured.model : '',
    configured?.provider === provider ? configured.thinkingLevel : '',
  );
  return {
    provider,
    model: selection.modelId,
    thinkingLevel: selection.reasoningLevel,
  };
}

export function selectLlmDefaultModel(
  models: readonly NativeAgentModelOption[],
  draft: LlmDefaultModelDraft,
  model: string,
): LlmDefaultModelDraft {
  const selected = selectModelCatalogModel(
    providerModelChoices(models, draft.provider),
    model,
    draft.thinkingLevel,
  );
  if (!selected) return draft;
  return {
    ...draft,
    model: selected.modelId,
    thinkingLevel: selected.reasoningLevel,
  };
}

function providerModelChoices(
  models: readonly NativeAgentModelOption[],
  provider: LlmProviderId,
  configured?: NativeAgentDefaultModel | null,
): LlmDefaultModelChoice[] {
  return groupProviderModelOptions(models, configured, provider).map(
    ({ provider: _, ...model }) => model,
  );
}
