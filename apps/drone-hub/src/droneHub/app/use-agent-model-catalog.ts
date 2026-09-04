import React from 'react';
import {
  formatModelDisplayLabel,
  normalizeExternalModelCatalog,
  type ExternalAgentModelCatalogModel,
} from '@drone/assistant-chat';
import type { UiMenuSelectEntry } from '../../ui/components';
import { profileStorageKey } from '../../profile-storage';

export type AgentModelCatalogOption = ExternalAgentModelCatalogModel;

type CachedAgentModelCatalog = {
  models: AgentModelCatalogOption[];
  discoveredAt: string | null;
};

const STORAGE_KEY = profileStorageKey('droneHub.agentModelCatalog.v5');
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CATALOG_UPDATED_EVENT = 'drone-hub:agent-model-catalog-updated';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeAgentModelCatalog(value: unknown): AgentModelCatalogOption[] {
  return normalizeExternalModelCatalog(value, { formatLabels: true });
}

function catalogDiscoveredAt(value: unknown): string | null {
  const timestamp = text((value as any)?.discoveredAt);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function readCache(): Record<string, CachedAgentModelCatalog> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => {
        const cached = value as any;
        return [
          key,
          {
            models: normalizeAgentModelCatalog(
              Array.isArray(cached) ? { models: cached } : cached,
            ),
            discoveredAt: catalogDiscoveredAt(cached),
          },
        ];
      }),
    );
  } catch {
    return {};
  }
}

function writeCache(
  key: string,
  models: AgentModelCatalogOption[],
  nextDiscoveredAt: string | null,
): { entry: CachedAgentModelCatalog; written: boolean } {
  const previous = readCache();
  const current = previous[key];
  const currentTimestamp = current?.discoveredAt ? Date.parse(current.discoveredAt) : NaN;
  const nextTimestamp = nextDiscoveredAt ? Date.parse(nextDiscoveredAt) : NaN;
  if (
    current?.models.length &&
    ((!models.length) ||
      (Number.isFinite(currentTimestamp) &&
        (!Number.isFinite(nextTimestamp) || nextTimestamp < currentTimestamp)))
  ) {
    return { entry: current, written: false };
  }
  const entry = { models, discoveredAt: nextDiscoveredAt };
  if (typeof localStorage === 'undefined') return { entry, written: true };
  try {
    const next = { ...previous, [key]: entry };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort cache only.
    return { entry, written: false };
  }
  return { entry, written: true };
}

export function cacheAgentModelCatalog(
  agentId: string,
  value: unknown,
): void {
  const cleanAgentId = text(agentId);
  if (!cleanAgentId) return;
  const models = normalizeAgentModelCatalog(value);
  if (models.length === 0) return;
  const key = cleanAgentId;
  const cached = writeCache(key, models, catalogDiscoveredAt(value));
  if (cached.written && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { key } }));
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
  const key = opts.agentId;
  const [models, setModels] = React.useState<AgentModelCatalogOption[]>(
    () => readCache()[key]?.models ?? [],
  );
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
    if (cached?.models.length) setModels(cached.models);
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ agent: opts.agentId, runtime: opts.runtime });
      const response = await fetch(`/api/model-catalog?${query.toString()}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.error || `Model detection failed (${response.status})`);
      const next = normalizeAgentModelCatalog(body);
      if (requestSequence !== requestSequenceRef.current) return;
      const nextDiscoveredAt = catalogDiscoveredAt(body);
      const nextStale = body?.stale === true;
      if (next.length === 0 && cached?.models.length) {
        setModels(cached.models);
        setDiscoveredAt(cached.discoveredAt);
        setStale(true);
        if (body?.error) setError(String(body.error));
        return;
      }
      const stored = writeCache(key, next, nextDiscoveredAt);
      if (!stored.written) {
        setModels(stored.entry.models);
        setDiscoveredAt(stored.entry.discoveredAt);
        setStale(false);
        return;
      }
      setModels(stored.entry.models);
      setDiscoveredAt(stored.entry.discoveredAt);
      setStale(nextStale);
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
    const cached = readCache()[key];
    setModels(cached?.models ?? []);
    setDiscoveredAt(cached?.discoveredAt ?? null);
    setStale(false);
    void load();
  }, [key, load]);

  React.useEffect(() => {
    if (!opts.enabled || typeof window === 'undefined') return;
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load, opts.enabled]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleCatalogUpdated = (event: Event) => {
      const updatedKey = String((event as CustomEvent<{ key?: string }>).detail?.key ?? '');
      if (updatedKey !== key) return;
      requestSequenceRef.current += 1;
      const cached = readCache()[key];
      setModels(cached?.models ?? []);
      setDiscoveredAt(cached?.discoveredAt ?? null);
      setLoading(false);
      setError(null);
      setStale(false);
    };
    window.addEventListener(CATALOG_UPDATED_EVENT, handleCatalogUpdated);
    return () => window.removeEventListener(CATALOG_UPDATED_EVENT, handleCatalogUpdated);
  }, [key]);

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
