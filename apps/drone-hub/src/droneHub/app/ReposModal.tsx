import React from 'react';
import { requestJson } from '../http';
import type { RepoSummary } from '../types';
import { DotenvImportSection, EnvEditorRows, useEnvDraftImport } from '../env';
import { createEnvDraftEntry, envDraftEntriesToMap, envValueEntriesToDraftEntries, validateEnvDraftEntries, type EnvDraftEntry } from '../env/env-utils';
import { copyText } from './clipboard';
import { IconCopy, IconSpinner, IconTrash } from './icons';

type RepoEnvPayload = {
  ok: true;
  repoPath: string;
  label: string;
  registered: boolean;
  autoApplyToNewContainerDrones: boolean;
  updatedAt: string | null;
  entries: Array<{ key: string; value: string; source: 'repo' }>;
};

type RepoAgentsPayload = {
  ok: true;
  repoPath: string;
  label: string;
  registered: boolean;
  mode: 'inherit' | 'override' | 'disabled';
  content: string;
  updatedAt: string | null;
  effectiveContent: string | null;
  effectiveSource: 'repo' | 'default' | null;
};

type ReposModalProps = {
  repos: RepoSummary[];
  reposError: string | null | undefined;
  reposLoading: boolean;
  activeRepoPath: string;
  deletingRepos: Record<string, boolean>;
  onClose: () => void;
  onToggleActiveRepoPath: (repoPath: string) => void;
  onDeleteRepo: (repoPath: string) => void;
  getGithubUrlForRepo: (repo: RepoSummary) => string | null;
};

function repoCardLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'No Repository';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export function ReposModal({
  repos,
  reposError,
  reposLoading,
  activeRepoPath,
  deletingRepos,
  onClose,
  onToggleActiveRepoPath,
  onDeleteRepo,
  getGithubUrlForRepo,
}: ReposModalProps) {
  const [selectedRepoPath, setSelectedRepoPath] = React.useState<string | null>(null);
  const [configLoading, setConfigLoading] = React.useState(false);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [autoApply, setAutoApply] = React.useState(false);
  const [entries, setEntries] = React.useState<EnvDraftEntry[]>([]);
  const [repoAgentsMode, setRepoAgentsMode] = React.useState<'inherit' | 'override' | 'disabled'>('inherit');
  const [repoAgentsContent, setRepoAgentsContent] = React.useState('');
  const normalizedActiveRepoPath = String(activeRepoPath ?? '').trim();
  const { importText, setImportText, importFromText, importFromFile } = useEnvDraftImport({
    setEntries,
    setNotice,
    importedMessage: (count) => `${count} variable${count === 1 ? '' : 's'} imported.`,
  });

  React.useEffect(() => {
    const knownRepoPaths = new Set(repos.map((repo) => String(repo.path ?? '').trim()).filter(Boolean));
    if (selectedRepoPath == null) {
      if (normalizedActiveRepoPath) {
        setSelectedRepoPath(normalizedActiveRepoPath);
        return;
      }
      setSelectedRepoPath(repos.length > 0 ? String(repos[0]?.path ?? '').trim() : '');
      return;
    }

    if (selectedRepoPath === '' || knownRepoPaths.has(selectedRepoPath)) return;

    if (normalizedActiveRepoPath) {
      setSelectedRepoPath(normalizedActiveRepoPath);
      return;
    }
    setSelectedRepoPath(repos.length > 0 ? String(repos[0]?.path ?? '').trim() : '');
  }, [normalizedActiveRepoPath, repos, selectedRepoPath]);

  const repoItems = React.useMemo(
    () => [{ path: '', addedAt: null, remoteUrl: null, github: null } as RepoSummary, ...repos],
    [repos],
  );

  const loadConfig = React.useCallback(async (repoPath: string) => {
    setConfigLoading(true);
    setConfigError(null);
    setNotice(null);
    try {
      const envPromise = requestJson<RepoEnvPayload>(`/api/repo-env?repoPath=${encodeURIComponent(repoPath)}`);
      const agentsPromise = repoPath
        ? requestJson<RepoAgentsPayload>(`/api/repo-agents?repoPath=${encodeURIComponent(repoPath)}`)
        : Promise.resolve<RepoAgentsPayload | null>(null);
      const [envPayload, agentsPayload] = await Promise.all([envPromise, agentsPromise]);
      setEntries(envValueEntriesToDraftEntries(envPayload.entries));
      setAutoApply(envPayload.autoApplyToNewContainerDrones);
      if (agentsPayload) {
        setRepoAgentsMode(agentsPayload.mode);
        setRepoAgentsContent(agentsPayload.content);
      } else {
        setRepoAgentsMode('inherit');
        setRepoAgentsContent('');
      }
    } catch (err: any) {
      setConfigError(err?.message ?? String(err));
    } finally {
      setConfigLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (selectedRepoPath == null) return;
    void loadConfig(selectedRepoPath);
  }, [loadConfig, selectedRepoPath]);

  const validationError = React.useMemo(() => validateEnvDraftEntries(entries), [entries]);

  const save = React.useCallback(async () => {
    if (validationError) {
      setNotice(validationError);
      return;
    }
    setSaving(true);
    try {
      const envPromise = requestJson<RepoEnvPayload>('/api/repo-env', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoPath: selectedRepoPath ?? '',
          autoApplyToNewContainerDrones: autoApply,
          vars: envDraftEntriesToMap(entries),
        }),
      });
      const agentsPromise =
        selectedRepoPath && selectedRepoPath.trim()
          ? requestJson<RepoAgentsPayload>('/api/repo-agents', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                repoPath: selectedRepoPath,
                mode: repoAgentsMode,
                content: repoAgentsContent,
              }),
            })
          : Promise.resolve<RepoAgentsPayload | null>(null);
      const [envPayload, agentsPayload] = await Promise.all([envPromise, agentsPromise]);
      setEntries(envValueEntriesToDraftEntries(envPayload.entries));
      setAutoApply(envPayload.autoApplyToNewContainerDrones);
      if (agentsPayload) {
        setRepoAgentsMode(agentsPayload.mode);
        setRepoAgentsContent(agentsPayload.content);
      }
      setConfigError(null);
      setNotice(selectedRepoPath ? 'Repository settings updated.' : 'Repository environment updated.');
    } catch (err: any) {
      setConfigError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }, [autoApply, entries, repoAgentsContent, repoAgentsMode, selectedRepoPath, validationError]);

  const currentRepoPath = selectedRepoPath ?? '';
  const selectedRepoMeta = repoItems.find((repo) => String(repo.path ?? '') === currentRepoPath) ?? null;
  const selectedGithubUrl = selectedRepoMeta ? getGithubUrlForRepo(selectedRepoMeta) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[1080px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
            Repository
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)] transition-all"
            title="Close"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-[320px_minmax(0,1fr)] min-h-[620px] max-h-[80vh]">
          <div className="border-r border-[var(--border)] overflow-y-auto">
            {reposError ? (
              <div className="m-4 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] p-2 text-[11px] text-[var(--red)]">
                Failed to load repos: {reposError}
              </div>
            ) : null}
            <div className="px-3 py-3 flex flex-col gap-1">
              {repoItems.map((repo) => {
                const repoPath = String(repo.path ?? '');
                const selected = repoPath === currentRepoPath;
                const githubUrl = repoPath ? getGithubUrlForRepo(repo) : null;
                const base = repoCardLabel(repoPath);
                const filtered = repoPath ? normalizedActiveRepoPath === repoPath : false;
                return (
                  <div
                    key={repoPath || '__no-repo__'}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRepoPath(repoPath)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedRepoPath(repoPath);
                      }
                    }}
                    className={`group/repo px-3 py-2.5 rounded border transition-all flex items-start justify-between gap-2 ${
                      selected
                        ? 'bg-[var(--selected)] border-[var(--accent-muted)] shadow-[0_0_8px_rgba(167,139,250,.06)]'
                        : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] text-[var(--fg-secondary)] truncate">{base}</div>
                      <div className="text-[10px] text-[var(--muted-dim)] truncate font-mono mt-0.5" title={repoPath || 'Shared scope for drones without a repository'}>
                        {repoPath || 'Shared scope for drones without a repository'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {repoPath ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggleActiveRepoPath(filtered ? '' : repoPath);
                          }}
                          className={`h-7 rounded border px-2 text-[9px] font-semibold tracking-wide uppercase ${
                            filtered
                              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                              : 'border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                          title={filtered ? 'Clear repo filter' : 'Filter sidebar to this repo'}
                        >
                          {filtered ? 'Filtered' : 'Filter'}
                        </button>
                      ) : null}
                      {githubUrl ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void copyText(githubUrl);
                          }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
                          title="Copy GitHub URL"
                          aria-label="Copy GitHub URL"
                        >
                          <IconCopy className="opacity-80" />
                        </button>
                      ) : null}
                      {repoPath ? (
                        <button
                          type="button"
                          disabled={Boolean(deletingRepos[repoPath])}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onDeleteRepo(repoPath);
                          }}
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors ${
                            deletingRepos[repoPath]
                              ? 'opacity-60 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                              : 'bg-[var(--red-subtle)] border-[rgba(248,81,73,.25)] text-[var(--red)] hover:bg-[rgba(248,81,73,.16)]'
                          }`}
                          title="Remove repo"
                          aria-label="Remove repo"
                        >
                          {deletingRepos[repoPath] ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!reposLoading && repos.length === 0 ? (
                <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
                  No registered repos yet. The `No Repository` scope still works for unrepoed drones.
                </div>
              ) : null}
            </div>
          </div>

          <div className="overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Scope
                </div>
                <div className="text-[18px] text-[var(--fg-secondary)] truncate">{repoCardLabel(currentRepoPath)}</div>
                <div className="text-[11px] text-[var(--muted-dim)] font-mono truncate" title={currentRepoPath || 'No Repository'}>
                  {currentRepoPath || 'No Repository'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || Boolean(validationError)}
                className={`h-9 rounded border px-4 text-[10px] font-semibold tracking-wide uppercase ${
                  saving || validationError
                    ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)]'
                    : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            {configLoading ? (
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
                Loading repository environment…
              </div>
            ) : null}
            {configError ? (
              <div className="rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">
                {configError}
              </div>
            ) : null}
            {notice ? (
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[11px] text-[var(--muted)]">
                {notice}
              </div>
            ) : null}

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                    Default Environment
                  </div>
                  <div className="text-[11px] text-[var(--muted-dim)]">
                    These variables are available to drones in this repository scope.
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] text-[var(--fg-secondary)]">
                  <input
                    type="checkbox"
                    checked={autoApply}
                    onChange={(event) => setAutoApply(event.target.checked)}
                    disabled={saving}
                  />
                  Auto-apply to new container drones
                </label>
              </div>

              <EnvEditorRows
                entries={entries}
                disabled={saving}
                emptyMessage="No repo environment variables configured yet."
                gridClassName="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto]"
                onChange={(id, field, value) => setEntries((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)))}
                onRemove={(id) => setEntries((prev) => prev.filter((row) => row.id !== id))}
                onAdd={() => setEntries((prev) => [...prev, createEnvDraftEntry()])}
              />
            </div>

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4 flex flex-col gap-3">
              <DotenvImportSection
                title="Import .env"
                description="Paste `.env` contents here or import a file. Matching keys update existing rows."
                importText={importText}
                onImportTextChange={setImportText}
                onImportText={importFromText}
                onImportFile={importFromFile}
                disabled={saving}
                placeholder={'API_KEY=secret\nDEBUG=true'}
                textareaClassName="min-h-[130px] rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-2 font-mono text-[11px] text-[var(--fg)] focus:outline-none"
              />
            </div>

            {currentRepoPath ? (
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                      AGENTS.md Override
                    </div>
                    <div className="text-[11px] text-[var(--muted-dim)]">
                      Choose whether this repo inherits the Hub default, replaces it, or disables injection entirely.
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--muted-dim)]">
                    {repoAgentsMode === 'override'
                      ? 'Custom override'
                      : repoAgentsMode === 'disabled'
                        ? 'Disabled'
                        : 'Inherited'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'inherit', label: 'Inherit default' },
                    { id: 'override', label: 'Custom override' },
                    { id: 'disabled', label: 'Disable' },
                  ] as const).map((option) => {
                    const active = repoAgentsMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setRepoAgentsMode(option.id)}
                        disabled={saving}
                        className={`h-9 rounded border px-3 text-[10px] font-semibold tracking-wide uppercase ${
                          active
                            ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                            : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)] hover:bg-[var(--hover)]'
                        } ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <textarea
                  value={repoAgentsContent}
                  onChange={(event) => setRepoAgentsContent(event.target.value)}
                  disabled={saving || repoAgentsMode !== 'override'}
                  spellCheck={false}
                  className={`min-h-[220px] rounded border px-3 py-3 font-mono text-[11px] focus:outline-none ${
                    saving || repoAgentsMode !== 'override'
                      ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)]'
                      : 'border-[var(--border-subtle)] bg-[var(--panel-raised)] text-[var(--fg)] focus:border-[var(--accent-muted)]'
                  }`}
                  placeholder={'# Repo-specific instructions\n\nOverride the Hub default for this repository only.'}
                />

                <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
                  Repo-attached container drones copy the effective content into the repo root as `AGENTS.md`.
                </div>
              </div>
            ) : (
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4 text-[11px] text-[var(--muted-dim)]">
                `AGENTS.md` injection only applies to repo-attached drones. The shared no-repository scope keeps environment variables only.
              </div>
            )}

            {selectedGithubUrl ? (
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                    Remote
                  </div>
                  <a href={selectedGithubUrl} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--accent)] truncate" title={selectedGithubUrl}>
                    {selectedGithubUrl}
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText(selectedGithubUrl)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                  title="Copy remote URL"
                >
                  <IconCopy className="opacity-80" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
