import React from 'react';
import { repoUnavailableReasonForRuntime } from '../droneHub/app/app-config';
import { droneHomePath, isDroneStartingOrSeeding } from '../droneHub/app/helpers';
import { requestJson } from '../droneHub/http';
import type { DroneFsEntry, DroneFsListPayload, DroneSummary } from '../droneHub/types';
import type { DroneOpenedFileState } from '../droneHub/files/opened-file-types';
import type { RemoteRepoPanelKey } from './remote-repo-panel-config';

const LazyDroneChangesDock = React.lazy(async () => ({
  default: (await import('../droneHub/changes/DroneChangesDock')).DroneChangesDock,
}));
const LazyDroneFilesDock = React.lazy(async () => ({
  default: (await import('../droneHub/files/DroneFilesDock')).DroneFilesDock,
}));
const LazyDronePullRequestsDock = React.lazy(async () => ({
  default: (await import('../droneHub/pullRequests/DronePullRequestsDock')).DronePullRequestsDock,
}));

type RemoteRepoPanelProps = {
  drone: DroneSummary;
  panel: RemoteRepoPanelKey;
  compactChanges?: boolean;
};

type RemoteRepoPanelsProps = {
  drone: DroneSummary;
};

const EMPTY_OPENED_FILE: DroneOpenedFileState = {
  path: null,
  name: null,
  loading: false,
  saving: false,
  error: null,
  kind: 'binary',
  mime: null,
  size: 0,
  content: '',
  dirty: false,
  mtimeMs: null,
  targetLine: null,
  targetColumn: null,
  navigationSeq: 0,
};

function remoteRepoState(drone: DroneSummary) {
  const repoPath = String(drone.repoPath ?? '').trim();
  const repoAttached = Boolean(drone.repoAttached ?? Boolean(repoPath));
  return {
    repoPath,
    repoAttached,
    disabled: isDroneStartingOrSeeding(drone.hubPhase ?? null),
    repoUnavailableReason: !repoAttached
      ? 'Attach a repo to this drone to view changes and PRs.'
      : repoUnavailableReasonForRuntime(drone.runtime),
  };
}

function RemotePanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">
      Loading {label}...
    </div>
  );
}

function normalizeRemoteFilesPath(rawPath: string): string {
  const trimmed = String(rawPath ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function remoteFileOpenUrl(droneId: string, entry: DroneFsEntry): string {
  const path = encodeURIComponent(entry.path);
  if (entry.isImage || entry.isVideo) {
    return `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${path}`;
  }
  return `/api/drones/${encodeURIComponent(droneId)}/fs/download?path=${path}`;
}

function RemoteFilesPanel({ drone }: { drone: DroneSummary }) {
  const defaultPath = React.useMemo(() => droneHomePath(drone), [drone]);
  const [path, setPath] = React.useState(defaultPath);
  const [entries, setEntries] = React.useState<DroneFsEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [viewMode, setViewMode] = React.useState<'list' | 'thumb'>('list');
  const disabled = isDroneStartingOrSeeding(drone.hubPhase ?? null);

  React.useEffect(() => {
    setPath(defaultPath);
    setEntries([]);
    setError(null);
  }, [defaultPath, drone.id]);

  React.useEffect(() => {
    if (disabled) {
      setLoading(false);
      setEntries([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const currentPath = normalizeRemoteFilesPath(path);
    setLoading(true);
    setError(null);
    void requestJson<DroneFsListPayload>(
      `/api/drones/${encodeURIComponent(drone.id)}/fs/list?path=${encodeURIComponent(currentPath)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (data.ok !== true) {
          throw new Error(data.error || 'filesystem request failed');
        }
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setPath(normalizeRemoteFilesPath(data.path || currentPath));
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError') return;
        setEntries([]);
        setError(String(err?.message ?? err ?? 'failed to load files'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [disabled, drone.id, path, refreshNonce]);

  const openFile = React.useCallback(
    (entry: DroneFsEntry) => {
      if (entry.kind !== 'file') return;
      window.open(remoteFileOpenUrl(drone.id, entry), '_blank', 'noopener,noreferrer');
    },
    [drone.id],
  );

  return (
    <LazyDroneFilesDock
      key={`${drone.id}-remote-files`}
      droneId={drone.id}
      droneName={drone.name}
      droneLabel={drone.name}
      path={path}
      homePath={defaultPath}
      entries={entries}
      loading={loading}
      error={error}
      startup={{
        waiting: disabled,
        timedOut: false,
        hubPhase: drone.hubPhase,
        hubMessage: drone.hubMessage,
      }}
      viewMode={viewMode}
      onSetViewMode={setViewMode}
      onOpenPath={(nextPath) => setPath(normalizeRemoteFilesPath(nextPath))}
      onOpenFile={openFile}
      onOpenFileInPanel={() => false}
      onRefresh={() => setRefreshNonce((value) => value + 1)}
      openedFile={EMPTY_OPENED_FILE}
    />
  );
}

export function RemoteRepoPanel({ drone, panel, compactChanges = false }: RemoteRepoPanelProps) {
  const { repoPath, repoAttached, disabled, repoUnavailableReason } = remoteRepoState(drone);

  if (panel === 'files') {
    return (
      <React.Suspense fallback={<RemotePanelLoading label="files" />}>
        <RemoteFilesPanel drone={drone} />
      </React.Suspense>
    );
  }

  if (panel === 'prs') {
    return (
      <React.Suspense fallback={<RemotePanelLoading label="PRs" />}>
        <LazyDronePullRequestsDock
          key={`${drone.id}-remote-prs`}
          droneId={drone.id}
          droneName={drone.name}
          repoAttached={repoAttached}
          repoPath={repoPath}
          repoUnavailableReason={repoUnavailableReason}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
          onRevealFileInFiles={() => {}}
          onOpenFileInEditor={() => {}}
        />
      </React.Suspense>
    );
  }

  return (
    <React.Suspense fallback={<RemotePanelLoading label="changes" />}>
      <LazyDroneChangesDock
        key={`${drone.id}-remote-changes`}
        droneId={drone.id}
        repoAttached={repoAttached}
        repoPath={repoPath}
        repoUnavailableReason={repoUnavailableReason}
        fixedContextMode="branch"
        initialViewMode={compactChanges ? 'stacked' : null}
        initialDiffViewType={compactChanges ? 'unified' : null}
        persistViewPreferences={!compactChanges}
        disabled={disabled}
        hubPhase={drone.hubPhase}
        hubMessage={drone.hubMessage}
        onRevealFileInFiles={() => {}}
        onOpenFileInEditor={() => {}}
      />
    </React.Suspense>
  );
}

export function RemoteRepoPanels({ drone }: RemoteRepoPanelsProps) {
  return (
    <div
      className="h-full min-h-0 min-w-0 bg-[var(--panel-alt)]"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-[var(--border)]">
        <RemoteRepoPanel drone={drone} panel="files" />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-[var(--border)]">
        <RemoteRepoPanel drone={drone} panel="changes" />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <RemoteRepoPanel drone={drone} panel="prs" />
      </div>
    </div>
  );
}
