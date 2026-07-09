import React from 'react';
import { AsyncPaneBoundary, type PaneModuleLoader } from '../droneHub/app/AsyncPaneBoundary';
import { repoUnavailableReasonForRuntime } from '../droneHub/app/app-config';
import { droneHomePath, isDroneStartingOrSeeding } from '../droneHub/app/helpers';
import { requestJsonWithTimeout } from '../droneHub/http';
import type { DroneFsEntry, DroneFsListPayload, DroneSummary } from '../droneHub/types';
import type { DroneOpenedFileState } from '../droneHub/files/opened-file-types';
import type { RemoteRepoPanelKey } from './remote-repo-panel-config';

type DroneChangesDockComponent = typeof import('../droneHub/changes/DroneChangesDock').DroneChangesDock;
type DroneFilesDockComponent = typeof import('../droneHub/files/DroneFilesDock').DroneFilesDock;
type DronePullRequestsDockComponent = typeof import('../droneHub/pullRequests/DronePullRequestsDock').DronePullRequestsDock;

const loadDroneChangesDock: PaneModuleLoader<DroneChangesDockComponent> = async () => (await import('../droneHub/changes/DroneChangesDock')).DroneChangesDock;
const loadDroneFilesDock: PaneModuleLoader<DroneFilesDockComponent> = async () => (await import('../droneHub/files/DroneFilesDock')).DroneFilesDock;
const loadDronePullRequestsDock: PaneModuleLoader<DronePullRequestsDockComponent> = async () => (await import('../droneHub/pullRequests/DronePullRequestsDock')).DronePullRequestsDock;

type RemoteRepoPanelProps = {
  drone: DroneSummary;
  panel: RemoteRepoPanelKey;
  compactChanges?: boolean;
};

type RemoteRepoPanelsProps = {
  drone: DroneSummary;
};

const FS_LIST_REQUEST_TIMEOUT_MS = 12_000;

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

function RemotePanelLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-3 text-[12px] text-[var(--red)]">
      <div className="max-w-full rounded-md border border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] px-3 py-3">
        <div>{message}</div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-7 px-2.5 rounded-md border border-[rgba(255,90,90,.35)] bg-[rgba(255,255,255,.02)] text-[10px] font-semibold tracking-wide uppercase text-[var(--red)] hover:brightness-110"
          style={{ fontFamily: 'var(--display)' }}
        >
          Retry
        </button>
      </div>
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

function RemoteFilesPanel({ DroneFilesDock, drone }: { DroneFilesDock: DroneFilesDockComponent; drone: DroneSummary }) {
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
    void requestJsonWithTimeout<DroneFsListPayload>(
      `/api/drones/${encodeURIComponent(drone.id)}/fs/list?path=${encodeURIComponent(currentPath)}`,
      { signal: controller.signal },
      FS_LIST_REQUEST_TIMEOUT_MS,
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
    <DroneFilesDock
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
      <AsyncPaneBoundary
        tab="files"
        label="Remote files"
        load={loadDroneFilesDock}
        loadingFallback={<RemotePanelLoading label="files" />}
        errorFallback={(message, retry) => <RemotePanelLoadError message={message} onRetry={retry} />}
      >
        {(DroneFilesDock) => <RemoteFilesPanel drone={drone} DroneFilesDock={DroneFilesDock} />}
      </AsyncPaneBoundary>
    );
  }

  if (panel === 'prs') {
    return (
      <AsyncPaneBoundary
        tab="prs"
        label="Remote PRs"
        load={loadDronePullRequestsDock}
        loadingFallback={<RemotePanelLoading label="PRs" />}
        errorFallback={(message, retry) => <RemotePanelLoadError message={message} onRetry={retry} />}
      >
        {(DronePullRequestsDock) => (
          <DronePullRequestsDock
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
        )}
      </AsyncPaneBoundary>
    );
  }

  return (
    <AsyncPaneBoundary
      tab="changes"
      label="Remote changes"
      load={loadDroneChangesDock}
      loadingFallback={<RemotePanelLoading label="changes" />}
      errorFallback={(message, retry) => <RemotePanelLoadError message={message} onRetry={retry} />}
    >
      {(DroneChangesDock) => (
        <DroneChangesDock
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
      )}
    </AsyncPaneBoundary>
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
