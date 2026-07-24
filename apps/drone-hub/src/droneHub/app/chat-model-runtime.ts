import type { ChatModelOption } from './app-types';

export type DisplayedChatModel = {
  label: string;
  source:
    | 'transcript'
    | 'configured'
    | 'current'
    | 'default'
    | 'loading'
    | 'unknown'
    | 'unsupported';
};

export type TranscriptRuntimeMetadata = {
  model: string | null;
  reasoning: string | null;
};

export function latestTranscriptRuntime(
  transcripts:
    | ReadonlyArray<{ model?: string | null; reasoning?: string | null; ok?: boolean }>
    | null
    | undefined,
): TranscriptRuntimeMetadata {
  const list = Array.isArray(transcripts) ? transcripts : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (!item || item.ok === false) continue;
    const model = String(item.model ?? '').trim();
    if (!model) continue;
    const reasoning = String(item.reasoning ?? '').trim();
    return { model, reasoning: reasoning || null };
  }
  return { model: null, reasoning: null };
}

export function latestTranscriptModel(
  transcripts:
    | ReadonlyArray<{ model?: string | null; reasoning?: string | null; ok?: boolean }>
    | null
    | undefined,
): string | null {
  return latestTranscriptRuntime(transcripts).model;
}

export function resolveDisplayedChatModel(
  configuredModelRaw: string | null | undefined,
  discoveredModels: ChatModelOption[],
  discoveryLoading: boolean,
  discoverySupported = true,
  lastAgentModelRaw?: string | null,
): DisplayedChatModel {
  const configuredModel = String(configuredModelRaw ?? '').trim();
  if (configuredModel) return { label: configuredModel, source: 'configured' };
  if (!discoverySupported) return { label: 'Not reported', source: 'unsupported' };

  const currentModel = discoveredModels.find(
    (model) => model.isCurrent && String(model.id ?? '').trim(),
  );
  if (currentModel) return { label: String(currentModel.id).trim(), source: 'current' };

  const defaultModel = discoveredModels.find(
    (model) => model.isDefault && String(model.id ?? '').trim(),
  );
  if (defaultModel) return { label: String(defaultModel.id).trim(), source: 'default' };

  const lastAgentModel = String(lastAgentModelRaw ?? '').trim();
  if (lastAgentModel) return { label: lastAgentModel, source: 'transcript' };
  if (discoveryLoading) return { label: 'Detecting…', source: 'loading' };
  return { label: 'Auto', source: 'unknown' };
}

export function resolveDisplayedReasoning(
  configuredReasoningRaw: string | null | undefined,
  displayedModel: DisplayedChatModel,
  discoveredModels: ChatModelOption[],
  lastRuntime: TranscriptRuntimeMetadata,
): string | null {
  const configuredReasoning = String(configuredReasoningRaw ?? '').trim().toLowerCase();
  if (configuredReasoning) return configuredReasoning;
  if (
    lastRuntime.reasoning &&
    (displayedModel.source === 'transcript' || lastRuntime.model === displayedModel.label)
  ) {
    return lastRuntime.reasoning;
  }
  const discovered = discoveredModels.find((model) => model.id === displayedModel.label);
  const discoveredDefault = String(discovered?.defaultReasoningLevel ?? '').trim();
  if (discoveredDefault) return discoveredDefault;
  return null;
}

export function displayedChatModelTitle(
  model: DisplayedChatModel,
  reasoningRaw?: string | null,
): string {
  const reasoning = String(reasoningRaw ?? '').trim();
  const suffix = reasoning ? `; reasoning: ${reasoning}` : '';
  if (model.source === 'transcript') {
    return `Model: ${model.label}${suffix} (used for the last agent message)`;
  }
  if (model.source === 'configured') return `Model: ${model.label}${suffix} (configured for this chat)`;
  if (model.source === 'current') return `Model: ${model.label}${suffix} (reported as current by the agent CLI)`;
  if (model.source === 'default') return `Model: ${model.label}${suffix} (reported as default by the agent CLI)`;
  if (model.source === 'loading') return 'Detecting the agent model';
  if (model.source === 'unsupported') return 'Model is not reported by this custom agent command';
  return 'The agent will choose its model automatically';
}

export function formatAgentModelMetadata(
  agentLabelRaw: string,
  model: DisplayedChatModel,
  reasoningRaw?: string | null,
): string {
  const agentLabel = String(agentLabelRaw ?? '').trim() || 'Not reported';
  const reasoning = String(reasoningRaw ?? '').trim();
  return `${agentLabel} (${model.label}${reasoning ? ` ${reasoning}` : ''})`;
}

export function formatReasoningLabel(valueRaw: string | null | undefined): string {
  const value = String(valueRaw ?? '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'off') return 'Off';
  if (value === 'xhigh') return 'X-high';
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}
