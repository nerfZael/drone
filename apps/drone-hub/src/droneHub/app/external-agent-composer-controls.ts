import type { ChatComposerControlsConfig } from '../chat';
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
  agentLabel: string;
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
  const autoModel = resolveDisplayedChatModel(
    null,
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
  const autoReasoning = resolveDisplayedReasoning(
    null,
    autoModel,
    opts.models,
    latestRuntime,
  );
  const catalogModelLabel = (modelId: string) =>
    opts.models.find((model) => model.id === modelId)?.label || modelId;
  const displayedModelLabel = formatModelDisplayLabel(catalogModelLabel(displayedModel.label));
  const autoModelLabel = formatModelDisplayLabel(catalogModelLabel(autoModel.label));
  const reasoningControlEnabled =
    opts.currentAgentKey === 'builtin:codex' ||
    opts.currentAgentKey === 'builtin:blip' ||
    opts.models.some((model) => (model.reasoningLevels?.length ?? 0) > 0);
  const autoCatalogModel = opts.models.find((model) => model.id === autoModel.label) ?? null;
  const autoReasoningLevels = autoCatalogModel?.reasoningLevels ?? [];
  const autoChoices =
    autoReasoningLevels.length > 0
      ? autoReasoningLevels.map((thinkingLevel) => ({
          provider: 'external',
          id: '',
          name: `Auto · ${autoModelLabel}`,
          thinkingLevel,
        }))
      : [
          {
            provider: 'external',
            id: '',
            name:
              autoModel.source === 'loading'
                ? 'Detecting models…'
                : autoModel.source === 'unknown'
                  ? 'Auto'
                  : `Auto · ${autoModelLabel}`,
            ...(autoReasoning ? { thinkingLevel: autoReasoning } : {}),
          },
        ];
  const modelChoices = [
    ...autoChoices,
    ...opts.models.flatMap((model) =>
      model.reasoningLevels?.length
        ? model.reasoningLevels.map((thinkingLevel) => ({
            provider: 'external',
            id: model.id,
            name: model.label,
            thinkingLevel,
          }))
        : [{ provider: 'external', id: model.id, name: model.label }],
    ),
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
        kind: 'label',
        id: 'external-agent',
        value: opts.agentLabel,
        title: `Agent: ${opts.agentLabel}`,
      },
      {
        kind: 'model-picker',
        id: 'external-model',
        currentProvider: 'external',
        currentModel: opts.currentModel ?? '',
        currentThinkingLevel: displayedReasoning ?? undefined,
        options: modelChoices,
        triggerLabel,
        title: displayedChatModelTitle(displayedModel, displayedReasoning),
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
          const nextReasoning =
            catalogModel?.defaultReasoningLevel ||
            (catalogModel?.reasoningLevels?.includes(displayedReasoning ?? '')
              ? displayedReasoning
              : catalogModel?.reasoningLevels?.[0]) ||
            choice.thinkingLevel;
          opts.onUpdate({
            model: choice.id,
            ...(reasoningControlEnabled && hasCatalogReasoning
              ? { reasoning: nextReasoning ?? null }
              : {}),
          });
        },
      },
    ],
  };
}
