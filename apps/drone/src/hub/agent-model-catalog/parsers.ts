import type { AgentModelCatalogModel } from './types';

const MODEL_ID_MAX_LENGTH = 160;

function normalizeReasoning(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value || value.length > 32 || !/^[a-z0-9._-]+$/.test(value)) return null;
  return value;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '')
    .replace(
      /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[A-Z@-_]/g,
      '',
    )
    .replace(/\r/g, '');
}

function reasoningMetadata(value: any): Pick<
  AgentModelCatalogModel,
  'reasoningLevels' | 'defaultReasoningLevel'
> {
  const rawLevels =
    value?.reasoningLevels ??
    value?.reasoning_levels ??
    value?.supportedReasoningLevels ??
    value?.supported_reasoning_levels ??
    value?.supportedReasoningEfforts ??
    value?.supported_reasoning_efforts;
  const reasoningLevels: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawLevels)) {
    for (const item of rawLevels) {
      const raw =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object'
            ? item.reasoning_effort ?? item.reasoningEffort ?? item.effort ?? item.level ?? item.name
            : '';
      const level = normalizeReasoning(raw);
      if (!level || seen.has(level)) continue;
      seen.add(level);
      reasoningLevels.push(level);
    }
  }
  const defaultReasoningLevel = normalizeReasoning(
    value?.defaultReasoningLevel ??
      value?.default_reasoning_level ??
      value?.defaultReasoningEffort ??
      value?.default_reasoning_effort,
  );
  if (defaultReasoningLevel && !seen.has(defaultReasoningLevel)) {
    reasoningLevels.push(defaultReasoningLevel);
  }
  return {
    ...(reasoningLevels.length > 0 ? { reasoningLevels } : {}),
    ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
  };
}

function createCollector() {
  const models: AgentModelCatalogModel[] = [];
  const seen = new Set<string>();
  const add = (
    idRaw: unknown,
    labelRaw?: unknown,
    metadata: Partial<AgentModelCatalogModel> = {},
  ) => {
    const id = String(idRaw ?? '').trim();
    if (!id || id.length > MODEL_ID_MAX_LENGTH || seen.has(id)) return;
    seen.add(id);
    const label = String(labelRaw ?? '').trim() || id;
    models.push({
      id,
      label,
      ...(metadata.isDefault ? { isDefault: true } : {}),
      ...(metadata.isCurrent ? { isCurrent: true } : {}),
      ...(metadata.reasoningLevels?.length
        ? { reasoningLevels: metadata.reasoningLevels }
        : {}),
      ...(metadata.defaultReasoningLevel
        ? { defaultReasoningLevel: metadata.defaultReasoningLevel }
        : {}),
    });
  };
  return { models, add };
}

export function parseAgentModelList(raw: string): AgentModelCatalogModel[] {
  const text = stripAnsi(raw);
  const collector = createCollector();

  const addUnknown = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) addUnknown(item);
      return;
    }
    if (typeof value === 'string') {
      collector.add(value, value);
      return;
    }
    if (typeof value !== 'object') return;
    const id = value.id ?? value.model ?? value.name ?? value.slug;
    const label = value.label ?? value.displayName ?? value.display_name ?? value.name ?? value.model ?? id;
    collector.add(id, label, {
      isDefault: Boolean(value.default ?? value.isDefault ?? value.is_default),
      isCurrent: Boolean(value.current ?? value.isCurrent ?? value.is_current),
      ...reasoningMetadata(value),
    });
    addUnknown(value.models ?? value.items ?? value.data ?? null);
  };

  const trimmed = text.trim();
  if (!trimmed) return collector.models;
  try {
    addUnknown(JSON.parse(trimmed));
  } catch {
    // Human-readable output is handled below.
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!(line.startsWith('{') || line.startsWith('['))) continue;
    try {
      addUnknown(JSON.parse(line));
    } catch {
      // Ignore malformed JSONL rows.
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*[-*]\s+/, '');
    const lower = line.toLowerCase();
    if (
      !line ||
      lower.startsWith('usage:') ||
      lower.startsWith('available models') ||
      lower.startsWith('loading models') ||
      lower.startsWith('tip:') ||
      lower.startsWith('options:')
    ) {
      continue;
    }
    const withLabel = line.match(
      /^([A-Za-z0-9][A-Za-z0-9._:/+-]{0,159})\s*-\s*(.+)$/,
    );
    if (withLabel) {
      const label = String(withLabel[2] ?? '')
        .replace(/\s+\((default|current)\)\s*$/i, '')
        .trim();
      collector.add(withLabel[1], label || withLabel[1], {
        isDefault: /\(default\)\s*$/i.test(line),
        isCurrent: /\(current\)\s*$/i.test(line),
      });
      continue;
    }
    const idOnly = line.match(/^([A-Za-z0-9][A-Za-z0-9._:/+-]{0,159})$/);
    if (idOnly) collector.add(idOnly[1], idOnly[1]);
  }
  return collector.models;
}

export function parseCodexModelCache(raw: string): AgentModelCatalogModel[] {
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    const list = Array.isArray(parsed?.models) ? parsed.models : [];
    const current = String(parsed?.current_model ?? parsed?.currentModel ?? '').trim();
    const defaultModel = String(parsed?.default_model ?? parsed?.defaultModel ?? '').trim();
    const collector = createCollector();
    const prioritizedModels: Array<{
      model: any;
      index: number;
      priority: number;
    }> = list.map((model: any, index: number) => ({
      model,
      index,
      priority: Number.isFinite(Number(model?.priority))
        ? Number(model.priority)
        : Number.POSITIVE_INFINITY,
    }));
    const availableModels = prioritizedModels
      .filter(({ model }: { model: any }) => {
        const visibility = String(model?.visibility ?? '').trim().toLowerCase();
        return visibility !== 'hide';
      })
      .sort((left, right) => left.priority - right.priority || left.index - right.index);
    for (const { model } of availableModels) {
      const id = model?.slug ?? model?.id ?? model?.model ?? model?.name;
      const modelId = String(id ?? '').trim();
      const label =
        model?.display_name ?? model?.displayName ?? model?.label ?? modelId;
      collector.add(modelId, label, {
        isCurrent: Boolean(current && current === modelId),
        isDefault: Boolean(defaultModel && defaultModel === modelId),
        ...reasoningMetadata(model),
      });
    }
    return collector.models;
  } catch {
    return [];
  }
}
