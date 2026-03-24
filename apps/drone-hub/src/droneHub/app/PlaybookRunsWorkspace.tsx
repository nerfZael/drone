import React from 'react';
import { timeAgo } from '../../domain';
import { requestJson } from '../http';
import type { PlaybookDefinition, PlaybookRunSummary } from '../types';
import { fetchJson, useNowMs, usePoll } from './hooks';
import { IconBoard, IconChevron } from './icons';
import { normalizePlaybookArtifactPath } from './playbook-config';
import { playbookArtifactKey, usePlaybookArtifactAvailability } from './use-playbook-artifact-availability';

type PlaybookRunsWorkspaceProps = {
  activeRepoPath: string;
  registeredRepoPaths: string[];
  pullHostBranchBeforeCreate: boolean;
  onSetActiveRepoPath: (next: string) => void;
  onClose: () => void;
  onOpenRun: (droneId: string, chatName: string) => void;
  onOpenArtifact: (droneId: string, chatName: string, path: string, name: string) => void;
};

function repoLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'All repos';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export function PlaybookRunsWorkspace({
  activeRepoPath,
  registeredRepoPaths,
  pullHostBranchBeforeCreate,
  onSetActiveRepoPath,
  onClose,
  onOpenRun,
  onOpenArtifact,
}: PlaybookRunsWorkspaceProps) {
  const [launchBusyById, setLaunchBusyById] = React.useState<Record<string, true>>({});
  const [actionBusyByKey, setActionBusyByKey] = React.useState<Record<string, true>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const repoQuery = React.useMemo(
    () => (activeRepoPath ? `?repoPath=${encodeURIComponent(activeRepoPath)}&refresh=${refreshNonce}` : `?refresh=${refreshNonce}`),
    [activeRepoPath, refreshNonce],
  );

  const { value: playbooksResp, error: playbooksError, loading: playbooksLoading } = usePoll<{ ok: true; playbooks: PlaybookDefinition[] }>(
    () => fetchJson('/api/playbooks'),
    5000,
    [],
  );
  const { value: runsResp, error: runsError, loading: runsLoading } = usePoll<{ ok: true; runs: PlaybookRunSummary[] }>(
    () => fetchJson(`/api/playbook-runs${repoQuery}`),
    2000,
    [repoQuery],
  );
  const nowMs = useNowMs(30_000, true);

  const playbooks = Array.isArray(playbooksResp?.playbooks) ? playbooksResp.playbooks : [];
  const runs = Array.isArray(runsResp?.runs) ? runsResp.runs : [];
  const artifactAvailabilityByKey = usePlaybookArtifactAvailability({ runs });

  const runPlaybook = React.useCallback(
    async (playbook: PlaybookDefinition) => {
      if (!activeRepoPath) {
        setActionError('Choose a repo before launching a playbook.');
        return;
      }
      setLaunchBusyById((prev) => ({ ...prev, [playbook.id]: true }));
      setActionError(null);
      try {
        await requestJson(`/api/playbooks/${encodeURIComponent(playbook.id)}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repoPath: activeRepoPath,
            pullHostBranchBeforeCreate,
          }),
        });
        setRefreshNonce((prev) => prev + 1);
      } catch (e: any) {
        setActionError(e?.message ?? String(e));
      } finally {
        setLaunchBusyById((prev) => {
          const next = { ...prev };
          delete next[playbook.id];
          return next;
        });
      }
    },
    [activeRepoPath, pullHostBranchBeforeCreate],
  );

  const sendRunAction = React.useCallback(async (run: PlaybookRunSummary, action: PlaybookDefinition['actions'][number]) => {
    const key = `${run.id}:${action.id}`;
    setActionBusyByKey((prev) => ({ ...prev, [key]: true }));
    setActionError(null);
    try {
      await requestJson(`/api/drones/${encodeURIComponent(run.droneId)}/chats/${encodeURIComponent(run.chatName)}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: action.message }),
      });
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full min-h-full px-4 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8 flex flex-col gap-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                Playbooks
              </div>
              <div className="text-[18px] font-semibold text-[var(--fg)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                Runs
              </div>
              <p className="text-[12px] text-[var(--muted)] mt-1 max-w-[72ch]">
                Launch repo-scoped hidden runs, watch their status, and open any run chat directly.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={activeRepoPath}
                onChange={(e) => onSetActiveRepoPath(e.target.value)}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
              >
                <option value="">All repos</option>
                {registeredRepoPaths.map((repoPath) => (
                  <option key={repoPath} value={repoPath}>
                    {repoLabel(repoPath)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Back
              </button>
            </div>
          </div>

          {(actionError || playbooksError || runsError) && (
            <div className="px-5 py-3 border-b border-[var(--border)] text-[11px] text-[var(--red)] bg-[var(--red-subtle)]">
              {actionError || playbooksError || runsError}
            </div>
          )}

          <div className="px-5 py-4 flex flex-col gap-4">
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <IconBoard className="opacity-70" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Launch
                </div>
              </div>
              {playbooksLoading ? (
                <div className="text-[11px] text-[var(--muted-dim)]">Loading playbooks...</div>
              ) : playbooks.length === 0 ? (
                <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
                  No playbooks yet. Create one in Settings &gt; Playbooks.
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {playbooks.map((playbook) => (
                    <div key={playbook.id} className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[12px] font-semibold text-[var(--fg)]">{playbook.label || 'Untitled playbook'}</div>
                          <div className="text-[10px] text-[var(--muted-dim)] mt-1">
                            {playbook.messages.length} run message{playbook.messages.length === 1 ? '' : 's'}
                            {playbook.actions.length > 0 ? `, ${playbook.actions.length} action button${playbook.actions.length === 1 ? '' : 's'}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void runPlaybook(playbook)}
                          disabled={!activeRepoPath || Boolean(launchBusyById[playbook.id])}
                          className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                            !activeRepoPath || launchBusyById[playbook.id]
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          Run
                        </button>
                      </div>
                      <div className="text-[11px] text-[var(--muted-dim)] whitespace-pre-wrap line-clamp-3">
                        {playbook.messages[0] ?? ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <IconChevron down className="opacity-70" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Current Runs
                </div>
              </div>
              {runsLoading ? (
                <div className="text-[11px] text-[var(--muted-dim)]">Loading runs...</div>
              ) : runs.length === 0 ? (
                <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
                  No playbook runs for {activeRepoPath ? repoLabel(activeRepoPath) : 'the current repo filter'}.
                </div>
              ) : (
                <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
                  <table className="w-full min-w-[920px] text-left">
                    <thead className="bg-[rgba(255,255,255,.03)]">
                      <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                        <th className="px-3 py-2 font-semibold">Playbook</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Summary</th>
                        <th className="px-3 py-2 font-semibold">Updated</th>
                        <th className="px-3 py-2 font-semibold">Actions</th>
                        <th className="px-3 py-2 font-semibold">Artifacts</th>
                        <th className="px-3 py-2 font-semibold">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => {
                        return (
                          <tr key={run.id} className="border-t border-[var(--border-subtle)] align-top">
                            <td className="px-3 py-3">
                              <div className="text-[12px] font-semibold text-[var(--fg)]">{run.playbookLabel}</div>
                              <div className="text-[10px] text-[var(--muted-dim)] mt-1">{repoLabel(run.repoPath)}</div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="inline-flex items-center rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
                                {run.status}
                              </div>
                              {run.statusError && <div className="text-[10px] text-[var(--red)] mt-2 max-w-[180px]">{run.statusError}</div>}
                            </td>
                            <td className="px-3 py-3">
                              <div className="text-[11px] text-[var(--fg-secondary)] max-w-[360px] whitespace-pre-wrap line-clamp-3">
                                {run.lastMessage || 'No assistant output yet.'}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="text-[11px] text-[var(--fg-secondary)]">{timeAgo(run.updatedAt, nowMs)}</div>
                              <div className="text-[10px] text-[var(--muted-dim)] mt-1">{run.runsCompleted} completed</div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-2 max-w-[260px]">
                                {run.actions.map((action) => {
                                  const busyKey = `${run.id}:${action.id}`;
                                  return (
                                    <button
                                      key={action.id}
                                      type="button"
                                      onClick={() => void sendRunAction(run, action)}
                                      disabled={Boolean(actionBusyByKey[busyKey])}
                                      className={`h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                        actionBusyByKey[busyKey]
                                          ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                                      }`}
                                      style={{ fontFamily: 'var(--display)' }}
                                      title={action.message}
                                    >
                                      {action.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-2 max-w-[280px]">
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
                                      className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                                      title={availability.path}
                                    >
                                      {availability.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => onOpenRun(run.droneId, run.chatName)}
                                className="h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                Open
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
