import type { ChatComposerControlsConfig } from '../chat';
import { buildModelCatalogChoices } from '@drone/assistant-chat';
import type { ChatModelOption } from './app-types';
import {
  displayedChatModelTitle,
  formatModelDisplayLabel,
  formatReasoningLabel,
  latestTranscriptRuntime,
  resolveDisplayedChatModel,
  resolveDisplayedReasoning,
} from './chat-model-runtime';

type ModelSettings = {
  model?: string | null;
  reasoning?: string | null;
};

export function buildExternalAgentComposerControls(opts: {
  hasChats: boolean;
  modelControlEnabled: boolean;
  currentAgentKey: string;
  models: ChatModelOption[];
  currentModel: string | null;
  currentReasoning: string | null;
  modelDisabled: boolean;
  loading: boolean;
  error: string | null;
  stale: boolean;
  transcripts:
    | ReadonlyArray<{
        model?: string | null;
        reasoning?: string | null;
        ok?: boolean;
      }>
    | null;
  onUpdate: (settings: ModelSettings) => void;
}): ChatComposerControlsConfig | undefined {
  if (!opts.hasChats || !opts.modelControlEnabled) return undefined;

  const latestRuntime = latestTranscriptRuntime(opts.transcripts);
  const displayedModel = resolveDisplayedChatModel(
    opts.currentModel,
    opts.models,
    opts.loading,
    opts.modelControlEnabled,
    latestRuntime.model,
  );
  const displayedReasoning = resolveDisplayedReasoning(
    opts.currentReasoning,
    displayedModel,
    opts.models,
    latestRuntime,
  );
  const catalogModelLabel = (modelId: string) =>
    opts.models.find((model) => model.id === modelId)?.label || modelId;
  const displayedModelLabel = formatModelDisplayLabel(catalogModelLabel(displayedModel.label));
  const selectedOpenRouterModel = opts.currentAgentKey === 'builtin:codex' && opts.currentModel?.startsWith('openrouter:');
  const selectedCatalogModel = opts.models.find((model) => model.id === displayedModel.label);
  // Claude Code lists effort levels without a default: unset, it uses the user's own setting.
  const agentChoosesDefaultReasoning = Boolean(
    selectedCatalogModel?.reasoningLevels?.length && !selectedCatalogModel.defaultReasoningLevel,
  );
  const reasoningControlEnabled = selectedOpenRouterModel
    ? Boolean(opts.models.find((model) => model.id === opts.currentModel)?.reasoningLevels?.length)
    : opts.currentAgentKey === 'native' || opts.currentAgentKey === 'builtin:codex' ||
      opts.currentAgentKey === 'builtin:blip' ||
      opts.models.some((model) => (model.reasoningLevels?.length ?? 0) > 0);
  const autoCatalogModel =
    opts.models.find((model) => model.isCurrent) ??
    opts.models.find((model) => model.isDefault) ??
    opts.models.find((model) => model.id === latestRuntime.model) ??
    null;
  const autoReasoningLevels = autoCatalogModel?.reasoningLevels ?? [];
  const autoChoices =
    autoReasoningLevels.length > 0
      ? autoReasoningLevels.map((thinkingLevel) => ({
          provider: 'external',
          id: '',
          name: 'Auto',
          thinkingLevel,
        }))
      : [
          {
            provider: 'external',
            id: '',
            name: 'Auto',
          },
        ];
  const modelChoices = [
    ...autoChoices,
    ...buildModelCatalogChoices(opts.models, 'external'),
  ];
  const statusMessage = opts.error
    ? `${opts.models.length > 0 ? 'Using the last detected catalog. ' : ''}${opts.error}`
    : opts.stale
      ? 'Updating the agent model catalog in the background…'
      : undefined;
  const triggerLabel = `${displayedModelLabel}${
    reasoningControlEnabled && displayedReasoning
      ? ` (${formatReasoningLabel(displayedReasoning)})`
      : ''
  }`;

  return {
    onboardingId: 'chat.composer.model',
    controls: [
      {
        kind: 'model-picker',
        id: 'external-model',
        currentProvider: 'external',
        currentModel: opts.currentModel ?? '',
        currentThinkingLevel: displayedReasoning ?? undefined,
        agentChoosesDefaultReasoning,
        options: modelChoices,
        triggerLabel,
        title: displayedChatModelTitle(displayedModel, displayedReasoning) +
          (opts.currentAgentKey === 'builtin:codex' ? ' Model changes apply to the next turn in this chat.' : ''),
        disabled: opts.modelDisabled,
        showReasoning: reasoningControlEnabled,
        searchable: true,
        searchPlaceholder: 'Search models',
        allowCustomModel: true,
        statusMessage,
        onSelect: (choice, selection) => {
          if (selection === 'reasoning') {
            opts.onUpdate({ reasoning: choice.thinkingLevel ?? null });
            return;
          }
          if (!choice.id) {
            opts.onUpdate({ model: null, reasoning: null });
            return;
          }
          const catalogModel = opts.models.find((model) => model.id === choice.id) ?? null;
          const hasCatalogReasoning = Boolean(catalogModel?.reasoningLevels?.length);
          const keptReasoning = catalogModel?.reasoningLevels?.includes(displayedReasoning ?? '')
            ? displayedReasoning
            : null;
          // A catalog model without a default lets the agent pick: keep the chat's level or leave it unset.
          const nextReasoning = hasCatalogReasoning && !catalogModel?.defaultReasoningLevel
            ? keptReasoning
            : catalogModel?.defaultReasoningLevel ||
              keptReasoning ||
              catalogModel?.reasoningLevels?.[0] ||
              choice.thinkingLevel;
          opts.onUpdate({
            model: choice.id,
            ...(hasCatalogReasoning
              ? { reasoning: nextReasoning ?? null }
              : choice.id.startsWith('openrouter:') ? { reasoning: null } : {}),
          });
        },
      },
    ],
  };
}
