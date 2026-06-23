import React from 'react';
import type { ChatAgentConfig } from '../domain';
import { normalizeChatInfoPayload } from '../domain';
import { BUILTIN_AGENT_OPTIONS } from '../droneHub/app/app-config';
import { IconChevron, IconPlus, IconSpinner } from '../droneHub/app/icons';
import { InitialMessageVoiceControls, type InitialMessageVoiceControlsHandle } from '../droneHub/app/InitialMessageVoiceControls';
import { RepoBranchSourceControls } from '../droneHub/app/RepoBranchSourceControls';
import { type RepoBranchSourceMode } from '../droneHub/app/drone-create-runtime';
import { repoPathLabel } from '../droneHub/app/repo-path-label';
import { useDroneHubUiStore } from '../droneHub/app/use-drone-hub-ui-store';
import type { DroneSummary, RepoRemoteBranchOption, RepoSummary } from '../droneHub/types';
import { UiMenuSelect, type UiMenuSelectEntry } from '../ui/menuSelect';
import { remoteRequestJson } from './remote-api';
import { suggestAndRenameRemoteDroneFromPrompt } from './remote-drone-auto-rename';

type RemoteCreateDroneModalProps = {
  open: boolean;
  drones: DroneSummary[];
  selectedDrone: DroneSummary | null;
  selectedChat: string;
  onClose: () => void;
  onCreated: (droneId: string) => void;
};

type RepoBranchesState = {
  loading: boolean;
  error: string | null;
  hostBranch: string | null;
  remoteBranches: RepoRemoteBranchOption[];
};

const EMPTY_BRANCHES: RepoBranchesState = {
  loading: false,
  error: null,
  hostBranch: null,
  remoteBranches: [],
};

function agentKey(agent: ChatAgentConfig): string {
  return agent.kind === 'builtin' ? `builtin:${agent.id}` : `custom:${agent.id}`;
}

function resolveBuiltinAgent(key: string): ChatAgentConfig | null {
  return BUILTIN_AGENT_OPTIONS.find((entry) => entry.key === key)?.agent ?? null;
}

function initialBranchSource(drone: DroneSummary | null): RepoBranchSourceMode {
  return drone?.repoSeedSource === 'remote' ? 'remote' : 'host';
}

export function RemoteCreateDroneModal({
  open,
  drones,
  selectedDrone,
  selectedChat,
  onClose,
  onCreated,
}: RemoteCreateDroneModalProps) {
  const pullHostBranchBeforeCreate = useDroneHubUiStore((state) => state.pullHostBranchBeforeCreate);
  const setPullHostBranchBeforeCreate = useDroneHubUiStore((state) => state.setPullHostBranchBeforeCreate);
  const [repos, setRepos] = React.useState<RepoSummary[]>([]);
  const [repoLoading, setRepoLoading] = React.useState(false);
  const [repoError, setRepoError] = React.useState<string | null>(null);
  const [branches, setBranches] = React.useState<RepoBranchesState>(EMPTY_BRANCHES);
  const [name, setName] = React.useState('');
  const [group, setGroup] = React.useState('');
  const [repoPath, setRepoPath] = React.useState('');
  const [persistVolume, setPersistVolume] = React.useState(false);
  const [branchSource, setBranchSource] = React.useState<RepoBranchSourceMode>('host');
  const [remoteBranch, setRemoteBranch] = React.useState('');
  const [seedAgent, setSeedAgent] = React.useState<ChatAgentConfig>({ kind: 'builtin', id: 'cursor' });
  const [seedModel, setSeedModel] = React.useState('');
  const [initialMessage, setInitialMessage] = React.useState('');
  const mountedRef = React.useRef(false);
  const initialMessageVoiceRef = React.useRef<InitialMessageVoiceControlsHandle | null>(null);
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const [loadingDefaults, setLoadingDefaults] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const selectedRepoPath = String(selectedDrone?.repoPath ?? '').trim();
    setName('');
    setGroup(String(selectedDrone?.group ?? '').trim());
    setRepoPath(selectedRepoPath);
    setPersistVolume(false);
    setBranchSource(initialBranchSource(selectedDrone));
    setRemoteBranch(String(selectedDrone?.repoSeedRemoteBranch ?? '').trim());
    setSeedAgent({ kind: 'builtin', id: 'cursor' });
    setSeedModel('');
    setInitialMessage('');
    setError(null);
  }, [open, selectedDrone]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRepoLoading(true);
    setRepoError(null);
    void remoteRequestJson<{ ok: true; repos: RepoSummary[] }>('/api/repos')
      .then((data) => {
        if (cancelled) return;
        setRepos(Array.isArray(data.repos) ? data.repos : []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setRepoError(String(err?.message ?? err ?? 'Failed to load repos.'));
        setRepos([]);
      })
      .finally(() => {
        if (!cancelled) setRepoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || !selectedDrone?.id) return;
    let cancelled = false;
    const chatName = String(selectedChat ?? '').trim() || 'default';
    setLoadingDefaults(true);
    void remoteRequestJson<any>(
      `/api/drones/${encodeURIComponent(selectedDrone.id)}/chats/${encodeURIComponent(chatName)}`,
    )
      .then((data) => {
        if (cancelled) return;
        const chatInfo = normalizeChatInfoPayload(data);
        setSeedAgent(chatInfo.agent);
        setSeedModel(chatInfo.agent.kind === 'builtin' ? String(chatInfo.model ?? '') : '');
      })
      .catch(() => {
        if (cancelled) return;
        setSeedAgent({ kind: 'builtin', id: 'cursor' });
        setSeedModel('');
      })
      .finally(() => {
        if (!cancelled) setLoadingDefaults(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedChat, selectedDrone?.id]);

  React.useEffect(() => {
    if (!open || !repoPath) {
      setBranches(EMPTY_BRANCHES);
      return;
    }
    let cancelled = false;
    setBranches({ ...EMPTY_BRANCHES, loading: true });
    void remoteRequestJson<{
      ok: true;
      hostBranch: string | null;
      remoteBranches: RepoRemoteBranchOption[];
    }>(`/api/repos/branches?repoPath=${encodeURIComponent(repoPath)}`)
      .then((data) => {
        if (cancelled) return;
        const remoteBranches = Array.isArray(data.remoteBranches) ? data.remoteBranches : [];
        setBranches({
          loading: false,
          error: null,
          hostBranch: String(data.hostBranch ?? '').trim() || null,
          remoteBranches,
        });
        setRemoteBranch((current) => {
          const trimmed = String(current ?? '').trim();
          if (trimmed && remoteBranches.some((entry) => entry.name === trimmed)) return trimmed;
          return remoteBranches[0]?.name ?? '';
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setBranches({
          ...EMPTY_BRANCHES,
          error: String(err?.message ?? err ?? 'Failed to load repo branches.'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoPath]);

  const repoEntries = React.useMemo<UiMenuSelectEntry[]>(() => {
    const byPath = new Map<string, RepoSummary>();
    for (const repo of repos) {
      const path = String(repo.path ?? '').trim();
      if (path) byPath.set(path, repo);
    }
    for (const drone of drones) {
      const path = String(drone.repoPath ?? '').trim();
      if (path && !byPath.has(path)) byPath.set(path, { path, addedAt: null, remoteUrl: null, github: null });
    }
    const entries: UiMenuSelectEntry[] = [{ value: '', label: 'No repo', title: 'No repo' }];
    for (const repo of Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))) {
      entries.push({
        value: repo.path,
        label: repoPathLabel(repo.path),
        title: repo.path,
        searchText: repo.path,
      });
    }
    return entries;
  }, [drones, repos]);

  const agentEntries = React.useMemo<UiMenuSelectEntry[]>(() => {
    const entries: UiMenuSelectEntry[] = BUILTIN_AGENT_OPTIONS.map((entry) => ({
      value: entry.key,
      label: entry.label,
      title: entry.label,
    }));
    if (seedAgent.kind === 'custom') {
      entries.push({ kind: 'separator' });
      entries.push({
        value: agentKey(seedAgent),
        label: seedAgent.label,
        title: seedAgent.command,
        searchText: `${seedAgent.label} ${seedAgent.command}`,
      });
    }
    return entries;
  }, [seedAgent]);

  const selectedAgentKey = agentKey(seedAgent);
  const seedModelDisabled = seedAgent.kind !== 'builtin' || creating || loadingDefaults;

  const createDrone = React.useCallback(async () => {
    if (creating || loadingDefaults || createSubmitting) return;
    const normalizedRepoPath = String(repoPath ?? '').trim();
    const normalizedBranchSource = normalizedRepoPath ? branchSource : 'host';
    const normalizedRemoteBranch = String(remoteBranch ?? '').trim();
    if (normalizedRepoPath && normalizedBranchSource === 'remote' && !normalizedRemoteBranch) {
      setError('Choose a remote branch before creating this drone.');
      return;
    }
    setCreateSubmitting(true);
    setError(null);
    try {
      const resolvedInitialMessage = initialMessageVoiceRef.current
        ? await initialMessageVoiceRef.current.stopAndAppendRecording()
        : initialMessage;
      if (resolvedInitialMessage == null) return;
      const trimmedSeedPrompt = String(resolvedInitialMessage ?? initialMessage ?? '').trim();
      setCreating(true);
      const response = await remoteRequestJson<{ ok: true; id: string; name: string }>('/api/drones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(name ?? '').trim(),
          runtime: 'container',
          persistVolume,
          group: String(group ?? '').trim(),
          repoPath: normalizedRepoPath,
          repoBranchSource: normalizedBranchSource,
          ...(normalizedBranchSource === 'remote' ? { remoteBranch: normalizedRemoteBranch } : {}),
          pullHostBranchBeforeCreate,
          seedAgent,
          seedModel: seedAgent.kind === 'builtin' ? String(seedModel ?? '').trim() : null,
          seedChat: 'default',
          seedPrompt: trimmedSeedPrompt,
          ...(trimmedSeedPrompt ? { seedSubmittedAt: new Date().toISOString() } : {}),
        }),
      });
      const droneId = String(response.id ?? '').trim();
      if (!droneId) throw new Error('Drone was created but the response did not include an id.');
      const shouldAutoRename = !String(name ?? '').trim() && Boolean(trimmedSeedPrompt);
      onCreated(droneId);
      onClose();
      if (shouldAutoRename) {
        void suggestAndRenameRemoteDroneFromPrompt({
          droneId,
          prompt: trimmedSeedPrompt,
          currentName: String(response.name ?? '').trim(),
          requestJson: remoteRequestJson,
        })
          .then((renameResult) => {
            if (renameResult.ok) onCreated(droneId);
            else {
              console.warn('[RemoteHub] create auto-rename skipped', {
                id: droneId,
                error: renameResult.error,
              });
            }
          })
          .catch((renameError) => {
            console.warn('[RemoteHub] create auto-rename skipped', {
              id: droneId,
              error: renameError instanceof Error ? renameError.message : String(renameError),
            });
          });
      }
    } catch (err: any) {
      setError(String(err?.message ?? err ?? 'Failed to create drone.'));
    } finally {
      if (mountedRef.current) {
        setCreateSubmitting(false);
        setCreating(false);
      }
    }
  }, [
    branchSource,
    createSubmitting,
    creating,
    group,
    initialMessage,
    loadingDefaults,
    name,
    onClose,
    onCreated,
    persistVolume,
    pullHostBranchBeforeCreate,
    remoteBranch,
    repoPath,
    seedAgent,
    seedModel,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(0,0,0,.58)] px-3 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)]">
        <div className="flex h-[52px] flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]">
              <IconPlus />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                New drone
              </div>
              <div className="truncate text-[10px] text-[var(--muted)]">
                {loadingDefaults ? 'Loading current chat defaults...' : selectedDrone ? `Defaults from ${selectedDrone.name}` : 'Container runtime'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={createDrone}
              disabled={creating || loadingDefaults || createSubmitting}
              className={`inline-flex h-8 items-center justify-center gap-2 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide transition-all ${
                creating || loadingDefaults || createSubmitting
                  ? 'cursor-wait border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] opacity-70'
                  : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Create drone"
            >
              {creating ? <IconSpinner className="h-3.5 w-3.5" /> : null}
              {creating ? 'Creating...' : createSubmitting ? 'Transcribing...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!creating && !createSubmitting) onClose();
              }}
              disabled={creating || createSubmitting}
              className={`inline-flex h-8 w-8 items-center justify-center rounded border border-[var(--border-subtle)] text-[var(--muted)] transition-colors ${
                creating || createSubmitting
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              }`}
              title="Close"
              aria-label="Close"
            >
              x
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="mb-4 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
              {error}
            </div>
          ) : null}
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  Name
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={creating}
                  placeholder="Optional"
                  className="h-9 w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)]"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  Group
                </span>
                <input
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  disabled={creating}
                  placeholder="Optional"
                  className="h-9 w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)]"
                />
              </label>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Repo
              </div>
              <UiMenuSelect
                variant="form"
                value={repoPath}
                onValueChange={setRepoPath}
                entries={repoEntries}
                disabled={creating || repoLoading}
                title={repoPath || 'No repo'}
                triggerLabel={repoPath ? repoPathLabel(repoPath) : repoLoading ? 'Loading repos...' : 'No repo'}
                triggerLabelClassName={repoPath ? 'font-mono text-[12px]' : undefined}
                panelClassName="right-auto w-full"
                menuClassName="max-h-[220px] overflow-y-auto"
                searchable
                searchPlaceholder="Search repos..."
                chevron={(menuOpen) => <IconChevron down={!menuOpen} className="flex-shrink-0 text-[var(--muted-dim)] opacity-70" />}
              />
              {repoError ? <div className="mt-1 text-[10px] text-[var(--red)]">{repoError}</div> : null}
            </div>

            {repoPath ? (
              <RepoBranchSourceControls
                repoPath={repoPath}
                hostBranch={branches.hostBranch}
                remoteBranches={branches.remoteBranches}
                loading={branches.loading}
                error={branches.error}
                branchSource={branchSource}
                onBranchSourceChange={setBranchSource}
                pullHostBranchBeforeCreate={pullHostBranchBeforeCreate}
                onPullHostBranchBeforeCreateChange={setPullHostBranchBeforeCreate}
                remoteBranch={remoteBranch}
                onRemoteBranchChange={setRemoteBranch}
                remoteBranchCheckoutEnabled
                disabled={creating}
                compact
              />
            ) : null}

            <label className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2">
              <input
                type="checkbox"
                checked={persistVolume}
                onChange={(event) => setPersistVolume(event.target.checked)}
                disabled={creating}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span className="text-[11px] text-[var(--muted)]">Persist container volume</span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  Agent
                </div>
                <UiMenuSelect
                  variant="form"
                  value={selectedAgentKey}
                  onValueChange={(value) => {
                    const builtin = resolveBuiltinAgent(value);
                    if (builtin) {
                      setSeedAgent(builtin);
                      return;
                    }
                    if (seedAgent.kind === 'custom' && value === agentKey(seedAgent)) return;
                  }}
                  entries={agentEntries}
                  disabled={creating || loadingDefaults}
                  panelClassName="right-auto w-full"
                />
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  Model
                </span>
                <input
                  value={seedModel}
                  onChange={(event) => setSeedModel(event.target.value)}
                  disabled={seedModelDisabled}
                  placeholder={seedAgent.kind === 'builtin' ? 'Default model' : 'Custom agent'}
                  className={`h-9 w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 font-mono text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] ${
                    seedModelDisabled ? 'opacity-50' : ''
                  }`}
                />
              </label>
            </div>

            <div className="block">
              <span className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  Initial message
                </span>
                <InitialMessageVoiceControls
                  ref={initialMessageVoiceRef}
                  value={initialMessage}
                  onChange={setInitialMessage}
                  disabled={creating}
                />
              </span>
              <textarea
                value={initialMessage}
                onChange={(event) => setInitialMessage(event.target.value)}
                disabled={creating || createSubmitting}
                rows={4}
                placeholder="Optional"
                aria-label="Initial message"
                className="min-h-[96px] w-full resize-y rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 py-2 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
