import React from 'react';
import { timeAgo } from '../../domain';
import { requestJson } from '../http';
import type { PlaybookDefinition, PlaybookRunQueueSummary, PlaybookRunSummary } from '../types';
import { fetchJson, useNowMs, usePoll } from './hooks';
import { IconBoard, IconSpinner, IconTrash } from './icons';
import { normalizePlaybookArtifactPath } from './playbook-config';
import {
  normalizePlaybookRunLaunchCount,
  PlaybookRunLaunchControls,
  PlaybookRunQueueSection,
  playbookRunsRepoLabel,
} from './playbook-runs-ui';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { playbookArtifactKey, usePlaybookArtifactAvailability } from './use-playbook-artifact-availability';

type PlaybookRunsWorkspaceProps = {
  initialRepoPath: string;
  registeredRepoPaths: string[];
  pullHostBranchBeforeCreate: boolean;
  onClose: () => void;
  onOpenPlaybookSettings: (playbookId: string) => void;
  onDeleteRunDrone: (droneId: string) => void;
  deletingDrones: Record<string, boolean>;
  optimisticallyDeletedDrones: Record<string, boolean>;
  onOpenRun: (droneId: string, chatName: string) => void;
  onOpenArtifact: (droneId: string, chatName: string, path: string, name: string) => void;
};

export function PlaybookRunsWorkspace({
  initialRepoPath,
  registeredRepoPaths,
  pullHostBranchBeforeCreate,
  onClose,
  onOpenPlaybookSettings,
  onDeleteRunDrone,
  deletingDrones,
  optimisticallyDeletedDrones,
  onOpenRun,
  onOpenArtifact,
}: PlaybookRunsWorkspaceProps) {
  const playbookRunsSelectionInitialized = useDroneHubUiStore((s) => s.playbookRunsSelectionInitialized);
  const setPlaybookRunsSelectionInitialized = useDroneHubUiStore((s) => s.setPlaybookRunsSelectionInitialized);
  const selectedPlaybookId = useDroneHubUiStore((s) => s.playbookRunsSelectedPlaybookId);
  const setStoredSelectedPlaybookId = useDroneHubUiStore((s) => s.setPlaybookRunsSelectedPlaybookId);
  const selectedRepoPath = useDroneHubUiStore((s) => s.playbookRunsSelectedRepoPath);
  const setStoredSelectedRepoPath = useDroneHubUiStore((s) => s.setPlaybookRunsSelectedRepoPath);
  const [launchPendingCountById, setLaunchPendingCountById] = React.useState<Record<string, number>>({});
  const [launchCountInput, setLaunchCountInput] = React.useState('1');
  const [serializeFirstMessageGroup, setSerializeFirstMessageGroup] = React.useState(false);
  const [actionBusyByKey, setActionBusyByKey] = React.useState<Record<string, true>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [expandedSummaryByRunId, setExpandedSummaryByRunId] = React.useState<Record<string, true>>({});
  const [refreshNonce, setRefreshNonce] = React.useState(0);

  const initialRepoPathNormalized = React.useMemo(() => String(initialRepoPath ?? '').trim(), [initialRepoPath]);

  const setSelectedPlaybookId = React.useCallback(
    (next: string | ((current: string) => string)) => {
      setPlaybookRunsSelectionInitialized(true);
      setStoredSelectedPlaybookId(next);
    },
    [setPlaybookRunsSelectionInitialized, setStoredSelectedPlaybookId],
  );

  const setSelectedRepoPath = React.useCallback(
    (next: string | ((current: string) => string)) => {
      setPlaybookRunsSelectionInitialized(true);
      setStoredSelectedRepoPath(next);
    },
    [setPlaybookRunsSelectionInitialized, setStoredSelectedRepoPath],
  );

  React.useEffect(() => {
    if (playbookRunsSelectionInitialized) return;
    if (!initialRepoPathNormalized) return;
    setStoredSelectedRepoPath(initialRepoPathNormalized);
    setPlaybookRunsSelectionInitialized(true);
  }, [
    initialRepoPathNormalized,
    playbookRunsSelectionInitialized,
    setPlaybookRunsSelectionInitialized,
    setStoredSelectedRepoPath,
  ]);

  React.useEffect(() => {
    if (!selectedRepoPath) return;
    if (registeredRepoPaths.length === 0) return;
    if (registeredRepoPaths.includes(selectedRepoPath)) return;
    setSelectedRepoPath('');
  }, [registeredRepoPaths, selectedRepoPath]);

  const runsQuery = React.useMemo(() => `?refresh=${refreshNonce}`, [refreshNonce]);

  const { value: playbooksResp, error: playbooksError, loading: playbooksLoading } = usePoll<{ ok: true; playbooks: PlaybookDefinition[] }>(
    () => fetchJson('/api/playbooks'),
    5000,
    [],
  );
  const { value: runsResp, error: runsError, loading: runsLoading } = usePoll<{ ok: true; runs: PlaybookRunSummary[]; queue: PlaybookRunQueueSummary[] }>(
    () => fetchJson(`/api/playbook-runs${runsQuery}`),
    2000,
    [runsQuery],
  );
  const nowMs = useNowMs(30_000, true);

  const playbooks = Array.isArray(playbooksResp?.playbooks) ? playbooksResp.playbooks : [];
  const runs = Array.isArray(runsResp?.runs) ? runsResp.runs : [];
  const queue = Array.isArray(runsResp?.queue) ? runsResp.queue : [];
  const visibleRuns = React.useMemo(
    () =>
      runs.filter(
        (run) => !deletingDrones[run.droneId] && !optimisticallyDeletedDrones[run.droneId],
      ),
    [deletingDrones, optimisticallyDeletedDrones, runs],
  );
  const artifactAvailabilityByKey = usePlaybookArtifactAvailability({ runs: visibleRuns });

  React.useEffect(() => {
    if (playbooksLoading) return;
    if (!selectedPlaybookId) return;
    if (playbooks.some((playbook) => playbook.id === selectedPlaybookId)) return;
    setSelectedPlaybookId('');
  }, [playbooks, playbooksLoading, selectedPlaybookId, setSelectedPlaybookId]);

  const selectedPlaybook = React.useMemo(
    () => playbooks.find((playbook) => playbook.id === selectedPlaybookId) ?? null,
    [playbooks, selectedPlaybookId],
  );
  const runsForSelectedRepo = React.useMemo(
    () => (selectedRepoPath ? visibleRuns.filter((run) => run.repoPath === selectedRepoPath) : visibleRuns),
    [selectedRepoPath, visibleRuns],
  );
  const playbookRunCountById = React.useMemo(() => {
    const next: Record<string, number> = {};
    for (const run of runsForSelectedRepo) next[run.playbookId] = (next[run.playbookId] ?? 0) + 1;
    return next;
  }, [runsForSelectedRepo]);
  const runsForSelectedPlaybook = React.useMemo(
    () => (selectedPlaybookId ? visibleRuns.filter((run) => run.playbookId === selectedPlaybookId) : visibleRuns),
    [selectedPlaybookId, visibleRuns],
  );
  const repoRunCountByPath = React.useMemo(() => {
    const next: Record<string, number> = {};
    for (const run of runsForSelectedPlaybook) next[run.repoPath] = (next[run.repoPath] ?? 0) + 1;
    return next;
  }, [runsForSelectedPlaybook]);
  const filteredRuns = React.useMemo(
    () =>
      visibleRuns.filter(
        (run) =>
          (!selectedPlaybookId || run.playbookId === selectedPlaybookId) &&
          (!selectedRepoPath || run.repoPath === selectedRepoPath),
      ),
    [selectedPlaybookId, selectedRepoPath, visibleRuns],
  );
  const filteredQueue = React.useMemo(
    () =>
      queue.filter(
        (item) =>
          (!selectedPlaybookId || item.playbookId === selectedPlaybookId) &&
          (!selectedRepoPath || item.repoPath === selectedRepoPath),
      ),
    [queue, selectedPlaybookId, selectedRepoPath],
  );
  const totalQueuedCount = React.useMemo(
    () => filteredQueue.reduce((sum, item) => sum + Math.max(0, item.remainingCount + item.inFlightCount), 0),
    [filteredQueue],
  );
  const normalizedLaunchCount = React.useMemo(() => normalizePlaybookRunLaunchCount(launchCountInput), [launchCountInput]);
  const selectedPlaybookPendingLaunchCount = selectedPlaybook ? launchPendingCountById[selectedPlaybook.id] ?? 0 : 0;
  const runDisabled = !selectedPlaybook || !selectedRepoPath;
  const runDisabledReason = !selectedPlaybook
    ? 'Select a playbook to launch.'
    : !selectedRepoPath
      ? 'Select a repo to launch the selected playbook.'
      : selectedPlaybookPendingLaunchCount > 0
        ? `Submitting ${selectedPlaybookPendingLaunchCount} queued run${selectedPlaybookPendingLaunchCount === 1 ? '' : 's'}.`
        : serializeFirstMessageGroup
          ? `Queue ${normalizedLaunchCount} run${normalizedLaunchCount === 1 ? '' : 's'} in serial mode.`
          : normalizedLaunchCount > 1
            ? `Queue ${normalizedLaunchCount} runs immediately.`
            : 'Run the selected playbook.';

  const runPlaybook = React.useCallback(
    async (playbook: PlaybookDefinition) => {
      if (!selectedRepoPath) {
        setActionError('Choose a repo before launching a playbook.');
        return;
      }
      const requestedCount = normalizePlaybookRunLaunchCount(launchCountInput);
      setLaunchPendingCountById((prev) => ({
        ...prev,
        [playbook.id]: (prev[playbook.id] ?? 0) + requestedCount,
      }));
      setActionError(null);
      setRefreshNonce((prev) => prev + 1);
      try {
        await requestJson(`/api/playbooks/${encodeURIComponent(playbook.id)}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repoPath: selectedRepoPath,
            pullHostBranchBeforeCreate,
            count: requestedCount,
            serializeFirstMessageGroup,
          }),
        });
        setRefreshNonce((prev) => prev + 1);
      } catch (e: any) {
        setActionError(e?.message ?? String(e));
      } finally {
        setLaunchPendingCountById((prev) => {
          const current = prev[playbook.id] ?? 0;
          if (current <= requestedCount) {
            const next = { ...prev };
            delete next[playbook.id];
            return next;
          }
          const next = { ...prev };
          next[playbook.id] = current - requestedCount;
          return next;
        });
      }
    },
    [launchCountInput, pullHostBranchBeforeCreate, selectedRepoPath, serializeFirstMessageGroup],
  );

  const removeQueuedRun = React.useCallback(async (queueItemId: string) => {
    setActionBusyByKey((prev) => ({ ...prev, [`queue:${queueItemId}`]: true }));
    setActionError(null);
    try {
      await requestJson(`/api/playbook-runs/queue/${encodeURIComponent(queueItemId)}`, {
        method: 'DELETE',
      });
      setRefreshNonce((prev) => prev + 1);
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
    } finally {
      setActionBusyByKey((prev) => {
        const next = { ...prev };
        delete next[`queue:${queueItemId}`];
        return next;
      });
    }
  }, []);

  const clearQueuedRuns = React.useCallback(async () => {
    setActionBusyByKey((prev) => ({ ...prev, 'queue:clear': true }));
    setActionError(null);
    try {
      await requestJson('/api/playbook-runs/queue/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(selectedPlaybookId ? { playbookId: selectedPlaybookId } : {}),
          ...(selectedRepoPath ? { repoPath: selectedRepoPath } : {}),
        }),
      });
      setRefreshNonce((prev) => prev + 1);
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
    } finally {
      setActionBusyByKey((prev) => {
        const next = { ...prev };
        delete next['queue:clear'];
        return next;
      });
    }
  }, [selectedPlaybookId, selectedRepoPath]);

  const sendRunAction = React.useCallback(async (run: PlaybookRunSummary, action: PlaybookDefinition['actions'][number]) => {
    const key = `${run.id}:${action.id}`;
    setActionBusyByKey((prev) => ({ ...prev, [key]: true }));
    setActionError(null);
    try {
      for (const prompt of action.messages) {
        await requestJson(`/api/drones/${encodeURIComponent(run.droneId)}/chats/${encodeURIComponent(run.chatName)}/prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt, submittedAt: new Date().toISOString() }),
        });
      }
      setRefreshNonce((prev) => prev + 1);
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
    } finally {
      setActionBusyByKey((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, []);

  const toggleRunSummary = React.useCallback((runId: string) => {
    setExpandedSummaryByRunId((prev) => {
      if (prev[runId]) {
        const next = { ...prev };
        delete next[runId];
        return next;
      }
      return { ...prev, [runId]: true };
    });
  }, []);

  const statusClass = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'running' || s === 'active' || s === 'streaming') return 'dh-run-status-badge--running';
    if (s === 'error' || s === 'failed') return 'dh-run-status-badge--error';
    if (s === 'completed' || s === 'done' || s === 'finished') return 'dh-run-status-badge--completed';
    return 'dh-run-status-badge--idle';
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* ── Header ── */}
      <div className="relative flex-shrink-0 border-b border-[var(--border-subtle)] bg-[var(--panel-alt)]">
        <div className="relative">
          <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-[var(--radius-xlarge)] bg-[var(--accent-subtle)] text-[var(--accent)]">
                  <IconBoard />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[15px] font-[var(--weight-semibold)] tracking-tight text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
                      Playbook Runs
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-medium)] bg-[var(--surface-strong)] px-2.5 py-1 text-[var(--text-10)] font-medium text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                      {filteredRuns.length}<span className="opacity-40">R</span>
                      {totalQueuedCount > 0 && <>{' '}{totalQueuedCount}<span className="opacity-40">Q</span></>}
                    </span>
                    {(runsLoading || playbooksLoading) && (
                      <span className="flex items-center gap-1.5 text-[var(--text-10)] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse-dot" />Loading
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[var(--text-11)] text-[var(--muted)] leading-relaxed max-w-[52ch]">
                    Launch playbooks, monitor active runs, and inspect artifacts.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 items-center justify-center rounded-[var(--radius-large)] px-3 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)] transition-all hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>

          {/* ── Filter pills ── */}
          <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
            {/* Playbook filters */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.1em] text-[var(--muted-dim)] mr-0.5" style={{ fontFamily: 'var(--display)' }}>Playbook</span>
              <button
                type="button"
                onClick={() => setSelectedPlaybookId('')}
                className={`inline-flex h-7 items-center rounded-[var(--radius-large)] px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide transition-all ${
                  selectedPlaybookId === ''
                    ? 'bg-[var(--fg)] text-[var(--panel)] shadow-[0_2px_8px_var(--shadow-color)]'
                    : 'bg-[var(--surface-strong)] text-[var(--muted-dim)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                All
                <span className="ml-1.5 text-[var(--text-9)] opacity-60" style={{ fontFamily: 'var(--code)' }}>{runsForSelectedRepo.length}</span>
              </button>
              {playbooks.map((playbook) => {
                const active = selectedPlaybookId === playbook.id;
                const count = playbookRunCountById[playbook.id] ?? 0;
                const pendingLaunchCount = launchPendingCountById[playbook.id] ?? 0;
                return (
                  <div key={playbook.id} className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => setSelectedPlaybookId((current) => (current === playbook.id ? '' : playbook.id))}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-large)] px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide transition-all ${
                        active
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-border)]'
                          : 'bg-[var(--surface-strong)] text-[var(--muted-dim)] border border-transparent hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                      {pendingLaunchCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)] animate-pulse-dot" />}
                      {playbook.label || 'Untitled'}
                      <span className="text-[var(--text-9)] opacity-50" style={{ fontFamily: 'var(--code)' }}>{count}</span>
                    </button>
                    {active && (
                      <button
                        type="button"
                        onClick={() => onOpenPlaybookSettings(playbook.id)}
                        className="ml-0.5 inline-flex h-7 items-center rounded-[var(--radius-large)] px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)] hover:bg-[var(--accent-subtle)]"
                        style={{ fontFamily: 'var(--display)' }}
                        title={`Edit "${playbook.label}"`}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="h-4 w-px bg-[var(--border-subtle)]" />

            {/* Repo filters */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.1em] text-[var(--muted-dim)] mr-0.5" style={{ fontFamily: 'var(--display)' }}>Repo</span>
              <button
                type="button"
                onClick={() => setSelectedRepoPath('')}
                className={`inline-flex h-7 items-center rounded-[var(--radius-large)] px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide transition-all ${
                  selectedRepoPath === ''
                    ? 'bg-[var(--fg)] text-[var(--panel)] shadow-[0_2px_8px_var(--shadow-color)]'
                    : 'bg-[var(--surface-strong)] text-[var(--muted-dim)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                All
                <span className="ml-1.5 text-[var(--text-9)] opacity-60" style={{ fontFamily: 'var(--code)' }}>{runsForSelectedPlaybook.length}</span>
              </button>
              {registeredRepoPaths.map((repoPath) => {
                const active = selectedRepoPath === repoPath;
                const count = repoRunCountByPath[repoPath] ?? 0;
                return (
                  <button
                    key={repoPath}
                    type="button"
                    onClick={() => setSelectedRepoPath((current) => (current === repoPath ? '' : repoPath))}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-large)] px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide transition-all ${
                      active
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-border)]'
                        : 'bg-[var(--surface-strong)] text-[var(--muted-dim)] border border-transparent hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                    {playbookRunsRepoLabel(repoPath)}
                    <span className="text-[var(--text-9)] opacity-50" style={{ fontFamily: 'var(--code)' }}>{count}</span>
                  </button>
                );
              })}
            </div>

            {(actionError || playbooksError || runsError) && (
              <div className="ml-auto flex items-center gap-1.5 text-[var(--text-10)] text-[var(--red)]" style={{ fontFamily: 'var(--code)' }}>
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />
                {actionError || playbooksError || runsError}
              </div>
            )}
          </div>

          {/* ── Launch controls ── */}
          <div className="px-6 pb-4">
            <PlaybookRunLaunchControls
              selectedPlaybook={selectedPlaybook}
              selectedRepoPath={selectedRepoPath}
              totalQueuedCount={totalQueuedCount}
              launchCountInput={launchCountInput}
              normalizedLaunchCount={normalizedLaunchCount}
              serializeFirstMessageGroup={serializeFirstMessageGroup}
              runDisabled={runDisabled}
              runDisabledReason={runDisabledReason}
              onLaunchCountInputChange={setLaunchCountInput}
              onSerializeFirstMessageGroupChange={setSerializeFirstMessageGroup}
              onRun={() => {
                if (selectedPlaybook) void runPlaybook(selectedPlaybook);
              }}
            />
          </div>
        </div>
        <div className="dh-accent-bar" />
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        {/* Queue section (compact) */}
        <PlaybookRunQueueSection
          queue={filteredQueue}
          selectedPlaybookLabel={selectedPlaybook?.label ?? null}
          selectedRepoPath={selectedRepoPath}
          nowMs={nowMs}
          actionBusyByKey={actionBusyByKey}
          onClearQueuedRuns={() => void clearQueuedRuns()}
          onRemoveQueuedRun={(queueItemId) => void removeQueuedRun(queueItemId)}
        />

        {/* Runs table */}
        {runsLoading && filteredRuns.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-[var(--text-11)] text-[var(--muted-dim)]">
            <IconSpinner className="text-[var(--accent)] opacity-60" />
            Loading runs...
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-12 text-[var(--text-12)] text-[var(--muted-dim)]">
            No runs found for the current filters.
          </div>
        ) : (
          <table className="dh-task-table w-full mt-2">
            <thead>
              <tr>
                <th className="text-left">Run</th>
                <th className="text-left w-[90px]">Status</th>
                <th className="text-left">Summary</th>
                <th className="text-left w-[80px]">Updated</th>
                <th className="text-left w-[140px]">Actions</th>
                <th className="text-left w-[120px]">Artifacts</th>
                <th className="w-[36px]" />
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                const summaryExpanded = Boolean(expandedSummaryByRunId[run.id]);
                const deleteBusy = Boolean(deletingDrones[run.droneId]);
                return (
                  <tr key={run.id} className="align-top">
                    <td>
                      <button
                        type="button"
                        onClick={() => onOpenRun(run.droneId, run.chatName)}
                        className="text-[var(--text-12)] font-medium text-[var(--accent)] hover:underline decoration-[var(--accent-muted)] underline-offset-2"
                        title={`Open "${run.playbookLabel}"`}
                      >
                        {run.playbookLabel}
                      </button>
                      <div className="text-[var(--text-9)] text-[var(--muted-dim)] mt-0.5" style={{ fontFamily: 'var(--code)' }}>{playbookRunsRepoLabel(run.repoPath)}</div>
                    </td>
                    <td>
                      <span className={`dh-run-status-badge ${statusClass(run.status)}`}>
                        {run.status}
                      </span>
                      {run.statusError && (
                        <div className="mt-1 text-[var(--text-9)] text-[var(--red)] max-w-[140px] leading-relaxed truncate" title={run.statusError}>
                          {run.statusError}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[280px]">
                      <button
                        type="button"
                        onClick={() => toggleRunSummary(run.id)}
                        className="block w-full text-left"
                        title={summaryExpanded ? 'Collapse summary' : 'Expand summary'}
                      >
                        <div
                          className={`text-[var(--text-11)] text-[var(--fg-secondary)] whitespace-pre-wrap leading-relaxed ${summaryExpanded ? '' : 'line-clamp-2'}`}
                        >
                          {run.lastMessage || <span className="italic text-[var(--muted-dim)]">No output yet.</span>}
                        </div>
                      </button>
                    </td>
                    <td>
                      <span className="text-[var(--text-10)] text-[var(--muted-dim)] tabular-nums" style={{ fontFamily: 'var(--code)' }}>
                        {timeAgo(run.updatedAt, nowMs)}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {run.actions.map((action) => {
                          const busyKey = `${run.id}:${action.id}`;
                          return (
                            <button
                              key={action.id}
                              type="button"
                              onClick={() => void sendRunAction(run, action)}
                              disabled={Boolean(actionBusyByKey[busyKey])}
                              className={`h-6 px-2 rounded-[var(--radius-medium)] text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                                actionBusyByKey[busyKey]
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--surface-soft)] border-[var(--border-subtle)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                              title={`${action.messages.length} queued message${action.messages.length === 1 ? '' : 's'}`}
                            >
                              {actionBusyByKey[busyKey] ? <IconSpinner className="inline mr-0.5 opacity-60" /> : null}
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {run.artifacts.map((artifactPath) => {
                          const normalizedArtifact = normalizePlaybookArtifactPath(artifactPath);
                          if (!normalizedArtifact) return null;
                          const availability = artifactAvailabilityByKey[playbookArtifactKey(run.id, normalizedArtifact)];
                          if (!availability?.exists) return null;
                          return (
                            <button
                              key={normalizedArtifact}
                              type="button"
                              onClick={() => onOpenArtifact(run.droneId, run.chatName, availability.path, availability.name)}
                              className="h-6 px-2 rounded-[var(--radius-medium)] text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide border bg-[var(--green-subtle)] border-[var(--green-border)] text-[var(--green)] hover:bg-[var(--green-subtle)] hover:border-[var(--green-border)]"
                              title={availability.path}
                              style={{ fontFamily: 'var(--code)' }}
                            >
                              {availability.name}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void onDeleteRunDrone(run.droneId)}
                        disabled={deleteBusy}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-medium)] transition-all ${
                          deleteBusy
                            ? 'opacity-40 cursor-not-allowed text-[var(--muted-dim)]'
                            : 'text-[var(--muted-dim)] opacity-0 hover:opacity-100 hover:bg-[var(--red-subtle)] hover:text-[var(--red)]'
                        }`}
                        title={deleteBusy ? `Removing "${run.droneName}"...` : `Delete "${run.droneName}"`}
                      >
                        {deleteBusy ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-80" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
