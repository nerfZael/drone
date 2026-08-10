import React from 'react';
import type { ExternalAgentModelCatalogModel } from '@drone/assistant-chat';
import { UiButton } from '../../ui/components';
import { cacheAgentModelCatalog } from './use-agent-model-catalog';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type RefreshedAgentCatalog = {
  agent: string;
  installed: boolean;
  models: ExternalAgentModelCatalogModel[];
  source?: 'live' | 'cache' | 'none';
  discoveredAt?: string;
  stale?: boolean;
  error?: string;
};

type RefreshInstalledAgentCatalogsResponse = {
  ok: true;
  runtime: 'host';
  refreshedAt: string;
  catalogs: RefreshedAgentCatalog[];
};

const AGENT_LABELS: Record<string, string> = {
  cursor: 'Cursor Agent',
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  pi: 'Pi',
  blip: 'Blip',
};

export function ExternalAgentModelsSettingsSection({
  requestJson,
}: {
  requestJson: RequestJsonFn;
}) {
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<RefreshInstalledAgentCatalogsResponse | null>(null);

  const refreshInstalledAgents = React.useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await requestJson<RefreshInstalledAgentCatalogsResponse>(
        '/api/model-catalog/refresh',
        { method: 'POST' },
      );
      setResult(response);
      for (const catalog of response.catalogs) {
        if (!catalog.installed || catalog.models.length === 0) continue;
        cacheAgentModelCatalog(catalog.agent, { models: catalog.models });
      }
    } catch (nextError: any) {
      setError(String(nextError?.message ?? nextError ?? 'Model refresh failed.'));
    } finally {
      setRefreshing(false);
    }
  }, [requestJson]);

  const installedCatalogs = result?.catalogs.filter((catalog) => catalog.installed) ?? [];
  const skippedCount = (result?.catalogs.length ?? 0) - installedCatalogs.length;
  const updatedCount = installedCatalogs.filter(
    (catalog) => catalog.models.length > 0 && !catalog.error,
  ).length;
  const failedCount = installedCatalogs.length - updatedCount;

  return (
    <div className="dh-settings-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="dh-type-heading">External agent model lists</div>
          <div className="mt-1 dh-type-supporting">
            Ask every supported agent installed on this computer for its current models, then update
            Drone Hub’s model menus.
          </div>
        </div>
        <UiButton
          variant="primary"
          onClick={() => void refreshInstalledAgents()}
          disabled={refreshing}
          loading={refreshing}
        >
          {refreshing ? 'Refreshing models…' : 'Refresh model lists'}
        </UiButton>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]"
        >
          {error}
        </div>
      ) : null}

      {!result ? (
        <div className="text-[var(--text-11)] text-[var(--muted-dim)]">
          Cursor Agent, Codex, Claude Code, OpenCode, Pi, and Blip are checked. Agents that are not
          available to the Drone Hub process are skipped.
        </div>
      ) : (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div className="text-[var(--text-11)] text-[var(--muted)]">
            Updated {updatedCount} {updatedCount === 1 ? 'catalog' : 'catalogs'}
            {failedCount > 0
              ? `; ${failedCount} installed ${failedCount === 1 ? 'agent did' : 'agents did'} not return models`
              : ''}
            {skippedCount > 0 ? `; skipped ${skippedCount} not available` : ''}.
          </div>

          {installedCatalogs.length === 0 ? (
            <div className="dh-settings-row px-3 py-3 text-[var(--text-12)] text-[var(--muted)]">
              No supported external agents were found on this computer.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {installedCatalogs.map((catalog) => (
                <div key={catalog.agent} className="dh-settings-row px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="dh-type-label">
                      {AGENT_LABELS[catalog.agent] ?? catalog.agent}
                    </div>
                    <div className="shrink-0 text-[var(--text-11)] text-[var(--fg-secondary)]">
                      {catalog.models.length > 0
                        ? `${catalog.models.length} ${catalog.models.length === 1 ? 'model' : 'models'}`
                        : 'No models'}
                    </div>
                  </div>
                  {catalog.error ? (
                    <div className="mt-1 text-[var(--text-11)] text-[var(--red)]">
                      {catalog.error}
                    </div>
                  ) : catalog.discoveredAt ? (
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">
                      Updated {new Date(catalog.discoveredAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
