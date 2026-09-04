import {
  modelCatalogReasoning,
  normalizeExternalModelCatalogModels,
} from '@drone/assistant-chat';
import type { AgentModelCatalogModel } from './types';

const MODEL_ID_MAX_LENGTH = 160;

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
  return modelCatalogReasoning(value);
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
    const [model] = normalizeExternalModelCatalogModels([{
      id,
      label,
      ...(metadata.isDefault ? { isDefault: true } : {}),
      ...(metadata.isCurrent ? { isCurrent: true } : {}),
      reasoningLevels: metadata.reasoningLevels ?? [],
      defaultReasoningLevel: metadata.defaultReasoningLevel ?? '',
    }]);
    if (model) models.push(model);
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

export function parseClaudeModelHelp(raw: string): AgentModelCatalogModel[] {
  const text = stripAnsi(raw).replace(/\s+/g, ' ').trim();
  const aliasExamples = text.match(
    /Provide an alias for the latest model\s*\(e\.g\.\s*([^)]*)\)/i,
  )?.[1];
  if (!aliasExamples) return [];

  const collector = createCollector();
  for (const match of aliasExamples.matchAll(/['"`]([A-Za-z0-9][A-Za-z0-9._+\[\]-]*)['"`]/g)) {
    const id = String(match[1] ?? '').trim();
    if (!id) continue;
    collector.add(id, `${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`);
  }
  return collector.models;
}

export function parseClaudeEmbeddedModels(raw: string): AgentModelCatalogModel[] {
  const latestByFamily = new Map<
    string,
    { id: string; label: string; version: number[] }
  >();
  const compareVersions = (left: number[], right: number[]): number => {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };

  for (const line of stripAnsi(raw).split('\n')) {
    const match = line.match(
      /id:"(claude-[^"]+)",family:"(haiku|sonnet|opus|fable)",display_name:"([^"]+)"/i,
    );
    if (!match) continue;
    const [, id = '', familyRaw = '', label = ''] = match;
    const family = familyRaw.toLowerCase();
    const version = (label.match(/\d+(?:\.\d+)*/) ?? ['0'])[0]
      .split('.')
      .map((part) => Number(part));
    const previous = latestByFamily.get(family);
    if (!previous || compareVersions(version, previous.version) > 0) {
      latestByFamily.set(family, { id, label, version });
    }
  }

  const collector = createCollector();
  for (const family of ['sonnet', 'fable', 'opus', 'haiku']) {
    const model = latestByFamily.get(family);
    if (model) collector.add(model.id, model.label);
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

export function parseCodexModelCacheFetchedAt(raw: string): string | null {
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    const value = String(parsed?.fetched_at ?? parsed?.fetchedAt ?? '').trim();
    const timestamp = Date.parse(value);
    return value && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  } catch {
    return null;
  }
}
