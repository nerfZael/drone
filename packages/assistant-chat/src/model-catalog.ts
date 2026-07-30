export type ModelCatalogModel = {
  id: string;
  label: string;
  reasoningLevels: string[];
  defaultReasoningLevel: string;
  isDefault?: boolean;
  isCurrent?: boolean;
};

export type ProviderModelCatalogModel = ModelCatalogModel & {
  provider: string;
};

export type ExternalAgentModelCatalogModel = ModelCatalogModel;

export type ModelCatalogChoice = {
  provider: string;
  id: string;
  name: string;
  thinkingLevel?: string;
};

export type ModelCatalogSelection = {
  modelId: string;
  reasoningLevel: string;
};

export type ModelCatalogChoiceSource = Pick<ModelCatalogModel, 'id'> &
  Partial<
    Pick<ModelCatalogModel, 'label' | 'reasoningLevels' | 'defaultReasoningLevel'>
  > & {
    provider?: string;
  };

export type ProviderModelCatalogOption = {
  provider?: unknown;
  id?: unknown;
  name?: unknown;
  thinkingLevel?: unknown;
};

export type ProviderModelCatalogDefault = {
  provider?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
};

export type NormalizeModelCatalogOptions = {
  formatLabels?: boolean;
};

export function externalModelCatalogIdentity(modelId: unknown): string {
  return text(modelId);
}

export function providerModelCatalogIdentity(provider: unknown, modelId: unknown): string {
  return JSON.stringify([text(provider), text(modelId)]);
}

export function normalizeModelReasoningLevel(value: unknown): string {
  const level = text(value).toLowerCase();
  if (!level || level.length > 32 || !/^[a-z0-9._-]+$/.test(level)) return '';
  return level;
}

export function modelCatalogReasoning(value: unknown): Pick<
  ModelCatalogModel,
  'reasoningLevels' | 'defaultReasoningLevel'
> {
  const model = record(value);
  const rawLevels =
    model?.reasoningLevels ??
    model?.reasoning_levels ??
    model?.supportedReasoningLevels ??
    model?.supported_reasoning_levels ??
    model?.supportedReasoningEfforts ??
    model?.supported_reasoning_efforts;
  const reasoningLevels: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawLevels)) {
    for (const item of rawLevels) {
      const itemRecord = record(item);
      const level = normalizeModelReasoningLevel(
        typeof item === 'string'
          ? item
          : itemRecord?.reasoning_effort ??
              itemRecord?.reasoningEffort ??
              itemRecord?.effort ??
              itemRecord?.level ??
              itemRecord?.name,
      );
      if (!level || seen.has(level)) continue;
      seen.add(level);
      reasoningLevels.push(level);
    }
  }

  const singleLevel = normalizeModelReasoningLevel(model?.thinkingLevel);
  if (singleLevel && !seen.has(singleLevel)) {
    seen.add(singleLevel);
    reasoningLevels.push(singleLevel);
  }

  const requestedDefault = normalizeModelReasoningLevel(
    model?.defaultReasoningLevel ??
      model?.default_reasoning_level ??
      model?.defaultReasoningEffort ??
      model?.default_reasoning_effort,
  );
  if (requestedDefault && !seen.has(requestedDefault)) {
    reasoningLevels.push(requestedDefault);
  }
  return {
    reasoningLevels,
    defaultReasoningLevel: requestedDefault || reasoningLevels[0] || '',
  };
}

export function normalizeExternalModelCatalog(
  value: unknown,
  options: NormalizeModelCatalogOptions = {},
): ExternalAgentModelCatalogModel[] {
  return normalizeExternalModelCatalogModels(catalogModels(value), options);
}

export function normalizeExternalModelCatalogModels(
  values: readonly unknown[],
  options: NormalizeModelCatalogOptions = {},
): ExternalAgentModelCatalogModel[] {
  const models: ExternalAgentModelCatalogModel[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeModel(value, options);
    if (!normalized) continue;
    const key = externalModelCatalogIdentity(normalized.id);
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(normalized);
  }
  return models;
}

export function normalizeProviderModelCatalog(
  value: unknown,
  fallbackProvider = '',
  options: NormalizeModelCatalogOptions = {},
): ProviderModelCatalogModel[] {
  return normalizeProviderModelCatalogModels(catalogModels(value), fallbackProvider, options);
}

export function normalizeProviderModelCatalogModels(
  values: readonly unknown[],
  fallbackProvider = '',
  options: NormalizeModelCatalogOptions = {},
): ProviderModelCatalogModel[] {
  const models: ProviderModelCatalogModel[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const raw = record(value);
    const normalized = normalizeModel(value, options);
    if (!raw || !normalized) continue;
    const provider = text(raw.provider) || text(fallbackProvider);
    if (!provider) continue;
    const key = providerModelCatalogIdentity(provider, normalized.id);
    if (seen.has(key)) continue;
    seen.add(key);
    models.push({ provider, ...normalized });
  }
  return models;
}

export function groupProviderModelOptions(
  models: readonly ProviderModelCatalogOption[],
  defaultModel?: ProviderModelCatalogDefault | null,
  providerFilter?: unknown,
): ProviderModelCatalogModel[] {
  const grouped = new Map<string, ProviderModelCatalogModel>();
  const selectedProvider = text(providerFilter);
  for (const model of models) {
    const provider = text(model?.provider);
    const id = text(model?.id);
    if (!provider || !id || (selectedProvider && provider !== selectedProvider)) continue;
    const key = providerModelCatalogIdentity(provider, id);
    const reasoningLevel = normalizeModelReasoningLevel(model?.thinkingLevel) || 'off';
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.reasoningLevels.includes(reasoningLevel)) {
        existing.reasoningLevels.push(reasoningLevel);
      }
      continue;
    }
    grouped.set(key, {
      provider,
      id,
      label: text(model?.name) || id,
      reasoningLevels: [reasoningLevel],
      defaultReasoningLevel: reasoningLevel,
    });
  }

  const configured = grouped.get(
    providerModelCatalogIdentity(defaultModel?.provider, defaultModel?.model),
  );
  const configuredReasoning = normalizeModelReasoningLevel(defaultModel?.thinkingLevel);
  if (configured && configured.reasoningLevels.includes(configuredReasoning)) {
    configured.defaultReasoningLevel = configuredReasoning;
  }
  return [...grouped.values()];
}

export function buildModelCatalogChoices(
  models: readonly ModelCatalogChoiceSource[],
  fallbackProvider = '',
): ModelCatalogChoice[] {
  return models.flatMap((model) => {
    const provider = text(model.provider) || text(fallbackProvider);
    const id = text(model.id);
    if (!provider || !id) return [];
    const { reasoningLevels } = modelCatalogReasoning(model);
    const base = {
      provider,
      id,
      name: text(model.label) || id,
    };
    return reasoningLevels.length > 0
      ? reasoningLevels.map((thinkingLevel) => ({ ...base, thinkingLevel }))
      : [base];
  });
}

export function resolveModelCatalogSelection(
  models: readonly ModelCatalogModel[],
  requestedModelId?: unknown,
  requestedReasoningLevel?: unknown,
): ModelCatalogSelection {
  const requestedId = text(requestedModelId);
  const selected = models.find((model) => model.id === requestedId) ?? models[0];
  if (!selected) return { modelId: '', reasoningLevel: '' };
  return {
    modelId: selected.id,
    reasoningLevel: validReasoningSelection(selected, requestedReasoningLevel),
  };
}

export function selectModelCatalogModel(
  models: readonly ModelCatalogModel[],
  modelId: unknown,
  currentReasoningLevel?: unknown,
): ModelCatalogSelection | null {
  const selected = models.find((model) => model.id === text(modelId));
  if (!selected) return null;
  return {
    modelId: selected.id,
    reasoningLevel: validReasoningSelection(selected, currentReasoningLevel),
  };
}

export function formatReasoningLabel(value: unknown): string {
  const level = normalizeModelReasoningLevel(value);
  if (!level) return '';
  if (level === 'off') return 'Off';
  if (level === 'xhigh') return 'X-high';
  return `${level[0]?.toUpperCase() ?? ''}${level.slice(1)}`;
}

export function formatModelDisplayLabel(value: unknown): string {
  const label = text(value).replace(/\s+\(custom\)$/i, '');
  if (!label) return '';
  if (/^gpt\s+/i.test(label)) return `GPT ${label.replace(/^gpt\s+/i, '')}`;
  if (!/^gpt(?:[-_\s]|$)/i.test(label)) return label;

  const suffix = label
    .replace(/^gpt[-_\s]*/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!suffix) return 'GPT';
  const [version, ...variantParts] = suffix.split(/\s+/).filter(Boolean);
  const formattedVersion = /^[0-9]/.test(version)
    ? `GPT-${version}`
    : `GPT ${version.toUpperCase()}`;
  const variant = variantParts
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`)
    .join(' ');
  return `${formattedVersion}${variant ? ` ${variant}` : ''}`;
}

function validReasoningSelection(model: ModelCatalogModel, requested: unknown): string {
  const { reasoningLevels } = modelCatalogReasoning({
    reasoningLevels: model.reasoningLevels,
  });
  const requestedLevel = normalizeModelReasoningLevel(requested);
  if (reasoningLevels.includes(requestedLevel)) return requestedLevel;
  const defaultLevel = normalizeModelReasoningLevel(model.defaultReasoningLevel);
  return reasoningLevels.includes(defaultLevel) ? defaultLevel : reasoningLevels[0] ?? '';
}

function normalizeModel(
  value: unknown,
  options: NormalizeModelCatalogOptions,
): ModelCatalogModel | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.id);
  if (!id) return null;
  const rawLabel = text(raw.label ?? raw.name) || id;
  return {
    id,
    label: options.formatLabels ? formatModelDisplayLabel(rawLabel) : rawLabel,
    ...(raw.isDefault || raw.default || raw.is_default ? { isDefault: true } : {}),
    ...(raw.isCurrent || raw.current || raw.is_current ? { isCurrent: true } : {}),
    ...modelCatalogReasoning(raw),
  };
}

function catalogModels(value: unknown): readonly unknown[] {
  const catalog = record(value);
  return Array.isArray(catalog?.models) ? catalog.models : [];
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}
