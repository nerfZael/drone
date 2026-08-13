import React from 'react';
import type { ChangeRequestChanges, ChangeRequestView } from '@drone/hub-model/change-requests';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import {
  UiPanel,
  UiPanelStatusStrip,
  UiTabs,
  UiToolbarButton,
  UiToolbarIconButton,
} from '../../ui/components';
import type { RepoBranchesPayload, RepoPullRequestChangesPayload } from '../types';
import { DroneChangesDock, ExternalLinkIcon, type DroneChangesReviewOverride } from '../changes/DroneChangesDock';
import { requestJson } from '../http';
import { RequestOverview } from '../requests/RequestOverview';
import { ChangeRequestGithubMirrorPanel } from './ChangeRequestGithubMirrorPanel';
import {
  closeChangeRequest,
  loadChangeRequestChanges,
  loadChangeRequestDiff,
  mergeChangeRequest,
  updateChangeRequest,
} from './change-request-api';
import {
  readPullRequestMergeMethod,
  writePullRequestMergeMethod,
} from '../pullRequests/pull-request-preferences';
import {
  changeRequestStatusClasses,
  changeRequestStatusLabel,
} from './change-request-presentation';

type ChangesPayload = Pick<ChangeRequestChanges, 'counts' | 'entries'> & { ok: true };
type ReviewPayload = Extract<RepoPullRequestChangesPayload, { ok: true }>;

export function ChangeRequestDetail({
  request,
  droneId,
  showChatName,
  repoAttached,
  repoPath,
  disabled,
  onBack,
  onChange,
  onRevealFileInFiles,
  onOpenFileInEditor,
}: {
  request: ChangeRequestView;
  droneId: string;
  showChatName: boolean;
  repoAttached: boolean;
  repoPath: string;
  disabled: boolean;
  onBack: () => void;
  onChange: (request: ChangeRequestView) => void;
  onRevealFileInFiles: (repoRelativePath: string) => void;
  onOpenFileInEditor: (repoRelativePath: string) => void;
}) {
  const confirm = useAppConfirmDialog();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [detailTab, setDetailTab] = React.useState<'overview' | 'files'>('overview');
  const [showMirror, setShowMirror] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(request.title);
  const [draftDescription, setDraftDescription] = React.useState(request.description);
  const [draftDestination, setDraftDestination] = React.useState(request.destinationBranch);
  const [githubMergeMethod, setGithubMergeMethod] = React.useState(readPullRequestMergeMethod);
  const [changes, setChanges] = React.useState<ChangesPayload | null>(null);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [changesError, setChangesError] = React.useState<string | null>(null);
  const [branchOptions, setBranchOptions] = React.useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = React.useState(false);

  React.useEffect(() => {
    setEditing(false);
    setDetailTab('overview');
    setShowMirror(false);
    setError(null);
    setDraftTitle(request.title);
    setDraftDescription(request.description);
    setDraftDestination(request.destinationBranch);
  }, [request.number]);

  React.useEffect(() => {
    if (editing) return;
    setDraftTitle(request.title);
    setDraftDescription(request.description);
    setDraftDestination(request.destinationBranch);
  }, [editing, request.description, request.destinationBranch, request.title]);

  React.useEffect(() => {
    if (request.status !== 'open') {
      setChanges(null);
      setChangesLoading(false);
      setChangesError(null);
      return;
    }
    let cancelled = false;
    setChangesLoading(true);
    setChangesError(null);
    loadChangeRequestChanges(request.number)
      .then((data) => {
        if (!cancelled) setChanges(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setChangesError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setChangesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request.number, request.revision, request.status]);

  React.useEffect(() => {
    const targetRepo = String(request.repoRoot || repoPath).trim();
    if (!targetRepo || !editing) return;
    let cancelled = false;
    setBranchesLoading(true);
    requestJson<RepoBranchesPayload>(`/api/repos/branches?repoPath=${encodeURIComponent(targetRepo)}`)
      .then((payload) => {
        if (cancelled || !payload.ok) return;
        const branches = [
          payload.hostBranch,
          ...payload.remoteBranches.map((entry) => entry.branch),
        ]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean);
        setBranchOptions(Array.from(new Set(branches)).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        if (!cancelled) setBranchOptions([]);
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, repoPath, request.repoRoot]);

  const mutate = React.useCallback(
    async (action: string, operation: () => Promise<ChangeRequestView>) => {
      setBusy(action);
      setError(null);
      try {
        const updated = await operation();
        onChange(updated);
        return updated;
      } catch (cause: unknown) {
        setError(errorMessage(cause));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [onChange],
  );

  const isOpen = request.status === 'open';
  const actionDisabled = disabled || busy !== null;

  const saveDetails = React.useCallback(async () => {
    if (!draftTitle.trim() || !draftDestination.trim()) return;
    const updated = await mutate('save', () =>
      updateChangeRequest(request.number, {
        title: draftTitle.trim(),
        description: draftDescription,
        destinationBranch: draftDestination.trim(),
        refreshSnapshot: false,
      }),
    );
    if (updated) setEditing(false);
  }, [draftDescription, draftDestination, draftTitle, mutate, request.number]);

  const reviewPayload = React.useMemo<ReviewPayload | null>(() => {
    if (!changes && request.status === 'open') return null;
    const fallbackStats = request.lineStats;
    return {
      ok: true,
      id: droneId,
      name: request.droneName,
      repoRoot: request.repoRoot,
      reviewScopeId: `change-request:${request.number}`,
      github: request.githubMirror
        ? { owner: request.githubMirror.owner, repo: request.githubMirror.repo }
        : { owner: '', repo: '' },
      pullRequest: {
        number: request.number,
        title: request.title,
        state: request.status,
        htmlUrl: request.githubMirror?.htmlUrl ?? null,
        baseRefName: request.destinationBranch,
        headRefName: request.baseBranch,
        baseSha: request.destinationSha ?? request.baseSha,
        headSha: request.snapshotSha ?? request.sourceHeadSha,
      },
      counts: {
        changed: changes?.counts.changed ?? fallbackStats?.files ?? 0,
        additions:
          changes?.counts.additions ??
          (fallbackStats ? fallbackStats.additions + fallbackStats.modifications : 0),
        deletions:
          changes?.counts.deletions ??
          (fallbackStats ? fallbackStats.deletions + fallbackStats.modifications : 0),
      },
      entries: (changes?.entries ?? []).map((entry) => ({
        ...entry,
        patch: null,
        truncated: false,
        isBinary: false,
        reviewKey: `${entry.originalPath ?? ''}\u0000${entry.path}`,
        reviewToken: `${request.snapshotSha ?? request.sourceHeadSha}\u0000${entry.path}`,
      })),
    };
  }, [changes, droneId, request]);

  const reviewLineCounts = React.useMemo(() => {
    if (changes) return changes.counts;
    if (!request.lineStats) return null;
    return {
      changed: request.lineStats.files,
      additions: request.lineStats.additions + request.lineStats.modifications,
      deletions: request.lineStats.deletions + request.lineStats.modifications,
      modified: request.lineStats.modifications,
    };
  }, [changes, request.lineStats]);

  const loadReviewDiff = React.useCallback(
    (path: string) => loadChangeRequestDiff(request.number, path),
    [request.number],
  );

  const merge = React.useCallback(async () => {
    if (
      !(await confirm({
        title: 'Merge change request?',
        message: `Squash-merge this change request into ${request.destinationBranch}?`,
        confirmLabel: 'Merge',
      }))
    ) return;
    void mutate('merge', () => mergeChangeRequest(request.number));
  }, [confirm, mutate, request.destinationBranch, request.number]);

  const close = React.useCallback(async () => {
    if (
      !(await confirm({
        title: 'Close change request?',
        message: 'Close this change request without merging it?',
        confirmLabel: 'Close request',
        destructive: true,
      }))
    ) return;
    void mutate('close', () => closeChangeRequest(request.number));
  }, [confirm, mutate, request.number]);

  const header = (
    <div className="border-b border-[var(--border-subtle)]">
      <div className="flex min-h-10 items-center gap-2 px-2 py-1.5">
        <UiToolbarIconButton
          size="xsmall"
          label="Back to change requests"
          title="Back to change requests"
          icon={<BackIcon />}
          onClick={onBack}
        />
        <button
          type="button"
          onClick={onBack}
          className="group min-w-0 flex-1 text-left"
          title="Back to change requests"
          aria-label={`Back to change requests from #${request.number}: ${request.title}`}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[16px] font-[var(--weight-bold)] text-[var(--fg)] group-hover:text-[var(--accent)]">
              {request.title || 'Untitled change request'}
            </span>
            <span className="shrink-0 font-mono text-[var(--text-10)] font-[var(--weight-normal)] text-[var(--muted-dim)]">
              #{request.number}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {isOpen ? (
            <>
              <UiToolbarButton size="xsmall" onClick={() => setEditing((value) => !value)} disabled={actionDisabled}>
                {editing ? 'Cancel' : 'Edit'}
              </UiToolbarButton>
              <UiToolbarButton size="xsmall" tone="success" loading={busy === 'merge'} disabled={actionDisabled || request.conflicted} onClick={() => void merge()}>
                Merge
              </UiToolbarButton>
              <UiToolbarButton size="xsmall" tone="danger" loading={busy === 'close'} disabled={actionDisabled} onClick={() => void close()}>
                Close
              </UiToolbarButton>
            </>
          ) : null}
          <span className={`inline-flex h-5 items-center rounded-full border px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] ${changeRequestStatusClasses(request)}`}>
            {changeRequestStatusLabel(request)}
          </span>
          <UiToolbarIconButton
            size="xsmall"
            label="GitHub mirror options"
            title="GitHub mirror options"
            icon={<GithubIcon />}
            pressed={showMirror}
            onClick={() => setShowMirror((value) => !value)}
          />
          {request.githubMirror?.htmlUrl ? (
            <a
              href={request.githubMirror.htmlUrl}
              target="_blank"
              rel="noreferrer"
              title="Open externally"
              aria-label="Open change request externally"
              className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            >
              <ExternalLinkIcon />
            </a>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="grid gap-2 border-t border-[var(--border-subtle)] px-2 py-2 md:grid-cols-2">
          <label className="min-w-0 text-[var(--text-9)] text-[var(--muted-dim)]">
            Title
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="mt-1 h-8 w-full rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-[var(--text-11)] text-[var(--field-fg)] focus:border-[var(--accent-muted)] focus:outline-none"
            />
          </label>
          <DestinationBranchPicker
            value={draftDestination}
            options={branchOptions}
            loading={branchesLoading}
            onChange={setDraftDestination}
          />
          <label className="min-w-0 text-[var(--text-9)] text-[var(--muted-dim)] md:col-span-2">
            Description
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              rows={2}
              className="mt-1 w-full resize-y rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 py-2 text-[var(--text-11)] text-[var(--field-fg)] focus:border-[var(--accent-muted)] focus:outline-none"
            />
          </label>
          <div className="flex justify-end gap-1 md:col-span-2">
            <UiToolbarButton size="xsmall" onClick={() => setEditing(false)}>Cancel</UiToolbarButton>
            <UiToolbarButton size="xsmall" tone="accent" active loading={busy === 'save'} disabled={actionDisabled || !draftTitle.trim() || !draftDestination.trim()} onClick={() => void saveDetails()}>
              Save
            </UiToolbarButton>
          </div>
        </div>
      ) : null}

      {request.conflicted ? (
        <UiPanelStatusStrip tone="danger">
          This request conflicts with {request.destinationBranch}{request.conflictFiles.length ? `: ${request.conflictFiles.join(', ')}` : '.'}
        </UiPanelStatusStrip>
      ) : null}
      {request.lastError ? <UiPanelStatusStrip tone="danger">{request.lastError}</UiPanelStatusStrip> : null}
      {error ? <UiPanelStatusStrip tone="danger">{error}</UiPanelStatusStrip> : null}
      {showMirror ? (
        <div className="border-t border-[var(--border-subtle)] px-2 pb-2">
          <ChangeRequestGithubMirrorPanel
            requestNumber={request.number}
            nativeStatus={request.status}
            mirror={request.githubMirror}
            disabled={actionDisabled}
            busy={busy}
            mergeMethod={githubMergeMethod}
            onMergeMethodChange={(method) => {
              setGithubMergeMethod(method);
              writePullRequestMergeMethod(method);
            }}
            mutate={mutate}
          />
        </div>
      ) : null}
    </div>
  );

  const renderTabs = React.useCallback(
    (controls: React.ReactNode = null) => (
      <div className="flex min-w-0 shrink-0 items-end overflow-x-auto border-b border-[var(--border-subtle)]">
        <UiTabs
          label="Change request sections"
          value={detailTab}
          onValueChange={setDetailTab}
          size="small"
          className="shrink-0 !border-b-0 px-2"
          options={[
            {
              value: 'overview',
              label: 'Overview',
              tabId: `change-request-${request.number}-overview-tab`,
              panelId: `change-request-${request.number}-overview-panel`,
            },
            {
              value: 'files',
              label: 'Files changed',
              badge: changes?.counts.changed ?? request.lineStats?.files ?? 0,
              tabId: `change-request-${request.number}-files-tab`,
              panelId: `change-request-${request.number}-files-panel`,
            },
          ]}
        />
        <div className="ml-auto flex h-8 shrink-0 items-center gap-1.5 pr-1.5">
          <span
            className="max-w-56 truncate px-1 font-mono text-[var(--text-9)] text-[var(--muted-dim)]"
            title={`${request.baseBranch} → ${request.destinationBranch}`}
          >
            {request.baseBranch} → {request.destinationBranch}
          </span>
          {controls}
        </div>
      </div>
    ),
    [changes?.counts.changed, detailTab, request.baseBranch, request.destinationBranch, request.lineStats?.files, request.number],
  );

  const reviewOverride = React.useMemo<DroneChangesReviewOverride>(
    () => ({
      kind: 'change-request',
      number: request.number,
      revisionKey: `${request.revision}:${request.snapshotSha ?? request.sourceHeadSha}`,
      payload: reviewPayload,
      lineCounts: reviewLineCounts,
      loading: changesLoading,
      error: changesError,
      renderHeader: (controls) => (
        <>
          {header}
          {renderTabs(controls)}
        </>
      ),
      loadingLabel: 'Loading change request…',
      loadDiff: loadReviewDiff,
    }),
    [changesError, changesLoading, header, loadReviewDiff, renderTabs, request.number, request.revision, request.snapshotSha, request.sourceHeadSha, reviewLineCounts, reviewPayload],
  );

  if (detailTab === 'overview') {
    return (
      <UiPanel flush surface="alternate" className="h-full w-full">
        {header}
        {renderTabs()}
        <ChangeRequestOverview
          request={request}
          showChatName={showChatName}
        />
      </UiPanel>
    );
  }

  return (
    <div
      id={`change-request-${request.number}-files-panel`}
      role="tabpanel"
      aria-labelledby={`change-request-${request.number}-files-tab`}
      className="h-full w-full"
    >
      <DroneChangesDock
        droneId={droneId}
        repoAttached={repoAttached}
        repoPath={repoPath}
        fixedContextMode="pull-request"
        reviewOverride={reviewOverride}
        disabled={disabled}
        onRevealFileInFiles={onRevealFileInFiles}
        onOpenFileInEditor={onOpenFileInEditor}
      />
    </div>
  );
}

function ChangeRequestOverview({
  request,
  showChatName,
}: {
  request: ChangeRequestView;
  showChatName: boolean;
}) {
  return (
    <RequestOverview
      id={`change-request-${request.number}-overview-panel`}
      labelledBy={`change-request-${request.number}-overview-tab`}
      description={request.description}
      facts={[
        { label: 'Created by', value: request.droneName },
        ...(showChatName ? [{ label: 'Chat', value: request.chatName }] : []),
        { label: 'Revision', value: String(request.revision) },
        { label: 'Created', value: formatDetailTime(request.createdAt) },
        { label: 'Updated', value: formatDetailTime(request.updatedAt) },
      ]}
    />
  );
}

function formatDetailTime(value: string | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

function DestinationBranchPicker({
  value,
  options,
  loading,
  onChange,
}: {
  value: string;
  options: string[];
  loading: boolean;
  onChange: (value: string) => void;
}) {
  const listId = React.useId();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const normalized = value.trim();
  const exists = options.some((option) => option === normalized);
  const visibleOptions = React.useMemo(() => {
    const query = normalized.toLowerCase();
    return options
      .filter((option) => !query || option.toLowerCase().includes(query))
      .slice(0, 10);
  }, [normalized, options]);

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 text-[var(--text-9)] text-[var(--muted-dim)]">
      <span>Destination branch</span>
      <input
        aria-label="Destination branch"
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder={loading ? 'Loading branches…' : 'Search or create a branch'}
        className="mt-1 h-8 w-full rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 font-mono text-[var(--text-10)] text-[var(--field-fg)] focus:border-[var(--accent-muted)] focus:outline-none"
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-raised)] p-1 shadow-lg"
        >
          {visibleOptions.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === normalized}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-mono text-[var(--text-10)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
            >
              <span className="truncate">{option}</span>
              {option === normalized ? <span className="text-[var(--accent)]">Selected</span> : null}
            </button>
          ))}
          {normalized && !exists ? (
            <button
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--text-10)] text-[var(--accent)] hover:bg-[var(--accent-subtle)]"
            >
              <span className="text-[var(--text-13)]">+</span>
              <span className="min-w-0 truncate">Create <span className="font-mono">{normalized}</span></span>
            </button>
          ) : null}
          {!loading && visibleOptions.length === 0 && (!normalized || exists) ? (
            <div className="px-2 py-2 text-[var(--text-10)] text-[var(--muted)]">No branches found.</div>
          ) : null}
        </div>
      ) : null}
      {normalized ? (
        <span className="mt-1 block text-[var(--text-9)] text-[var(--muted-dim)]">
          {exists ? 'Existing branch' : 'A new branch will be created when merged'}
        </span>
      ) : null}
    </div>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m9.5 3-5 5 5 5M5 8h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 1.3a6.7 6.7 0 0 0-2.12 13.06c.34.06.46-.15.46-.33v-1.3c-1.88.41-2.28-.8-2.28-.8-.3-.78-.75-.99-.75-.99-.62-.42.04-.41.04-.41.68.05 1.04.7 1.04.7.61 1.04 1.6.74 1.99.57.06-.44.24-.74.43-.91-1.5-.17-3.08-.75-3.08-3.35 0-.74.26-1.34.7-1.81-.07-.17-.3-.86.07-1.79 0 0 .57-.18 1.84.69A6.4 6.4 0 0 1 8 4.42c.57 0 1.13.08 1.66.23 1.28-.87 1.84-.69 1.84-.69.37.93.14 1.62.07 1.79.44.47.7 1.07.7 1.81 0 2.61-1.59 3.18-3.1 3.35.25.21.46.63.46 1.27v1.85c0 .18.12.4.47.33A6.7 6.7 0 0 0 8 1.3Z" />
    </svg>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
