import React from 'react';
import type { UiMenuSelectEntry } from '../../ui/components';
import { profileStorageKey } from '../../profile-storage';
import { formatModelDisplayLabel } from './chat-model-runtime';

export type AgentModelCatalogOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  isCurrent?: boolean;
  reasoningLevels: string[];
  defaultReasoningLevel: string;
};

const STORAGE_KEY = profileStorageKey('droneHub.agentModelCatalog.v3');
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeAgentModelCatalog(value: unknown): AgentModelCatalogOption[] {
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
    if (requestedDefault && !reasoningLevels.includes(requestedDefault)) {
      reasoningLevels.push(requestedDefault);
    }
    return [{
      id,
      label: formatModelDisplayLabel(text(raw?.label) || id),
      ...(raw?.isDefault ? { isDefault: true } : {}),
      ...(raw?.isCurrent ? { isCurrent: true } : {}),
      reasoningLevels,
      defaultReasoningLevel: requestedDefault || reasoningLevels[0] || '',
    }];
  });
}

function readCache(): Record<string, AgentModelCatalogOption[]> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, models]) => [key, normalizeAgentModelCatalog({ models })]),
    );
  } catch {
    return {};
  }
}

function writeCache(key: string, models: AgentModelCatalogOption[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    const next = { ...readCache(), [key]: models };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort cache only.
  }
}

export function buildDetectedModelMenuEntries(
  models: AgentModelCatalogOption[],
  currentModel: string,
): UiMenuSelectEntry[] {
  const current = text(currentModel);
  const includesCurrent = models.some((model) => model.id === current);
  return [
    { value: '', label: 'Auto' },
    ...models.map((model) => ({
      value: model.id,
      label: model.label,
      title: model.id,
      searchText: `${model.label} ${model.id}`,
      className: 'font-mono truncate',
    })),
    ...(current && !includesCurrent
      ? [{ value: current, label: formatModelDisplayLabel(current), title: current, className: 'font-mono truncate' }]
      : []),
  ];
}

export function useAgentModelCatalog(opts: {
  agentId: string;
  runtime: 'container' | 'host';
  enabled: boolean;
}) {
  const key = `${opts.runtime}:${opts.agentId}`;
  const [models, setModels] = React.useState<AgentModelCatalogOption[]>(() => readCache()[key] ?? []);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [discoveredAt, setDiscoveredAt] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false);
  const requestSequenceRef = React.useRef(0);
  const staleRetryAtRef = React.useRef<string | null>(null);
  const staleRetryTimerRef = React.useRef<number | null>(null);

  const load = React.useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;
    if (!opts.enabled || !opts.agentId) {
      setModels([]);
      setLoading(false);
      setError(null);
      setDiscoveredAt(null);
      setStale(false);
      return;
    }
    const cached = readCache()[key];
    if (cached?.length) setModels(cached);
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ agent: opts.agentId, runtime: opts.runtime });
      const response = await fetch(`/api/model-catalog?${query.toString()}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.error || `Model detection failed (${response.status})`);
      const next = normalizeAgentModelCatalog(body);
      if (requestSequence !== requestSequenceRef.current) return;
      const nextDiscoveredAt = text(body?.discoveredAt) || null;
      const nextStale = body?.stale === true;
      setDiscoveredAt(nextDiscoveredAt);
      setStale(nextStale);
      if (next.length === 0 && body?.error && cached?.length) {
        setModels(cached);
        setError(String(body.error));
        return;
      }
      setModels(next);
      writeCache(key, next);
      if (body?.error) setError(String(body.error));
    } catch (nextError: any) {
      if (requestSequence !== requestSequenceRef.current) return;
      setError(String(nextError?.message ?? nextError ?? 'Model detection failed.'));
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [key, opts.agentId, opts.enabled, opts.runtime]);

  React.useEffect(() => {
    staleRetryAtRef.current = null;
    const cached = readCache()[key] ?? [];
    setModels(cached);
    setDiscoveredAt(null);
    setStale(false);
    void load();
  }, [key, load]);

  React.useEffect(() => {
    if (!opts.enabled || typeof window === 'undefined') return;
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load, opts.enabled]);

  React.useEffect(() => {
    if (
      !stale ||
      !discoveredAt ||
      staleRetryAtRef.current === discoveredAt ||
      typeof window === 'undefined'
    ) {
      return;
    }
    staleRetryAtRef.current = discoveredAt;
    staleRetryTimerRef.current = window.setTimeout(() => {
      staleRetryTimerRef.current = null;
      void load();
    }, 2500);
    return () => {
      if (staleRetryTimerRef.current != null) {
        window.clearTimeout(staleRetryTimerRef.current);
        staleRetryTimerRef.current = null;
      }
    };
  }, [discoveredAt, load, stale]);

  React.useEffect(
    () => () => {
      requestSequenceRef.current += 1;
      if (staleRetryTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(staleRetryTimerRef.current);
      }
    },
    [],
  );

  return {
    models,
    loading,
    error,
    discoveredAt,
    stale,
  };
}
