import React from 'react';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import { profileStorageKey } from '../../profile-storage';

export type SpawnModelCatalogOption = {
  id: string;
  label: string;
  reasoningLevels: string[];
  defaultReasoningLevel: string;
};

const STORAGE_KEY = profileStorageKey('droneHub.spawnModelCatalog.v1');

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeSpawnModelCatalog(value: unknown): SpawnModelCatalogOption[] {
  const models = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as any).models
    : null;
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  return models.flatMap((raw: any) => {
    const id = text(raw?.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const reasoningLevels = Array.isArray(raw?.reasoningLevels)
      ? [...new Set(raw.reasoningLevels.map(text).filter(Boolean))] as string[]
      : [];
    const requestedDefault = text(raw?.defaultReasoningLevel);
    return [{
      id,
      label: text(raw?.label) || id,
      reasoningLevels,
      defaultReasoningLevel: reasoningLevels.includes(requestedDefault)
        ? requestedDefault
        : reasoningLevels[0] ?? '',
    }];
  });
}

function readCache(): Record<string, SpawnModelCatalogOption[]> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, models]) => [key, normalizeSpawnModelCatalog({ models })]),
    );
  } catch {
    return {};
  }
}

function writeCache(key: string, models: SpawnModelCatalogOption[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    const next = { ...readCache(), [key]: models };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort cache only.
  }
}

export function buildDetectedModelMenuEntries(
  models: SpawnModelCatalogOption[],
  currentModel: string,
): UiMenuSelectEntry[] {
  const current = text(currentModel);
  const includesCurrent = models.some((model) => model.id === current);
  return [
    { value: '', label: 'Default model' },
    ...models.map((model) => ({
      value: model.id,
      label: model.label,
      title: model.id,
      searchText: `${model.label} ${model.id}`,
      className: 'font-mono truncate',
    })),
    ...(current && !includesCurrent
      ? [{ value: current, label: `${current} (custom)`, title: current, className: 'font-mono truncate' }]
      : []),
  ];
}

export function useSpawnModelCatalog(opts: {
  agentId: string;
  runtime: 'container' | 'host';
  enabled: boolean;
}) {
  const key = `${opts.runtime}:${opts.agentId}`;
  const [models, setModels] = React.useState<SpawnModelCatalogOption[]>(() => readCache()[key] ?? []);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (refresh = false) => {
    if (!opts.enabled || !opts.agentId) {
      setModels([]);
      return;
    }
    const cached = readCache()[key];
    if (!refresh && cached?.length) setModels(cached);
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ agent: opts.agentId, runtime: opts.runtime });
      if (refresh) query.set('refresh', '1');
      const response = await fetch(`/api/model-catalog?${query.toString()}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.error || `Model detection failed (${response.status})`);
      const next = normalizeSpawnModelCatalog(body);
      if (next.length === 0 && body?.error && cached?.length) {
        setModels(cached);
        setError(String(body.error));
        return;
      }
      setModels(next);
      writeCache(key, next);
      if (body?.error && next.length === 0) setError(String(body.error));
    } catch (nextError: any) {
      setError(String(nextError?.message ?? nextError ?? 'Model detection failed.'));
    } finally {
      setLoading(false);
    }
  }, [key, opts.agentId, opts.enabled, opts.runtime]);

  React.useEffect(() => {
    setModels(readCache()[key] ?? []);
    void load(false);
  }, [key, load]);

  return { models, loading, error, refresh: () => load(true) };
}
