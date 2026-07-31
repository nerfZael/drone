import React from 'react';

import type { SyncSet, SyncSetTargetStatus } from './settings-types';
import {
  EMPTY_SYNC_SET_DRAFT,
  SyncSetFields,
  actionButtonClass,
  buildSyncSetDraftFromSyncSet,
  cloneSyncSetDraft,
  secondaryButtonClass,
} from './sync-set-form';
import type { SyncSetDraftInput, UseSyncSetsResult } from './use-sync-sets';

function summarizeTargetStates(statuses: SyncSetTargetStatus[]) {
  let synced = 0;
  let errors = 0;
  let idle = 0;
  for (const status of statuses) {
    if (status.state === 'synced') synced += 1;
    else if (status.state === 'error') errors += 1;
    else idle += 1;
  }
  return { synced, errors, idle, total: statuses.length };
}

function sourceTypeLabel(sourceType: SyncSet['sourceType']): string {
  return sourceType === 'hub-managed' ? 'Hub-managed storage' : 'Host directory';
}

function shortVersion(versionId: string | null): string {
  const value = String(versionId ?? '').trim();
  if (!value) return 'Never applied';
  return value.slice(0, 12);
}

function syncStatusBadgeClass(state: SyncSetTargetStatus['state']): string {
  if (state === 'synced') {
    return 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]';
  }
  if (state === 'error') {
    return 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]';
  }
  return 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)]';
}


export function SyncSettingsTab({ syncSets: syncSetsState }: { syncSets: UseSyncSetsResult }) {
  const {
    syncSets,
    syncSetsLoading,
    syncSetsError,
    syncSetsNotice,
    creatingSyncSet,
    savingSyncSetId,
    deletingSyncSetId,
    applyingSyncSetId,
    createSyncSet,
    updateSyncSet,
    deleteSyncSet,
    applySyncSetToExistingDrones,
  } = syncSetsState;
  const [createDraft, setCreateDraft] = React.useState<SyncSetDraftInput>(cloneSyncSetDraft(EMPTY_SYNC_SET_DRAFT));
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editDrafts, setEditDrafts] = React.useState<Record<string, SyncSetDraftInput>>({});

  const isCreateBusy = creatingSyncSet || Boolean(savingSyncSetId) || Boolean(deletingSyncSetId) || Boolean(applyingSyncSetId);
  const createReady =
    Boolean(String(createDraft.label).trim()) &&
    Boolean(String(createDraft.targetPath).trim()) &&
    (createDraft.sourceType === 'hub-managed' || Boolean(String(createDraft.sourcePath).trim()));

  const handleCreate = React.useCallback(async () => {
    const created = await createSyncSet(createDraft);
    if (!created) return;
    setCreateDraft(cloneSyncSetDraft(EMPTY_SYNC_SET_DRAFT));
  }, [createDraft, createSyncSet]);

  const startEditing = React.useCallback((syncSet: SyncSet) => {
    setEditingId(syncSet.id);
    setEditDrafts((current) => ({
      ...current,
      [syncSet.id]: buildSyncSetDraftFromSyncSet(syncSet),
    }));
  }, []);

  const cancelEditing = React.useCallback((syncSetId: string) => {
    setEditingId((current) => (current === syncSetId ? null : current));
    setEditDrafts((current) => {
      const next = { ...current };
      delete next[syncSetId];
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {syncSetsError ? (
        <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
          {syncSetsError}
        </div>
      ) : null}
      {syncSetsNotice ? (
        <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
          {syncSetsNotice}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-4">
        <div className="dh-settings-section">
          <div className="flex flex-col gap-2">
            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              New sync set
            </div>
            <div className="text-[var(--text-12)] text-[var(--muted)] leading-relaxed">
              Every sync set targets all drones. New drones always receive the latest mirror after provisioning, and existing drones update only when you run apply.
            </div>
          </div>

          <SyncSetFields
            draft={createDraft}
            disabled={isCreateBusy}
            onChange={setCreateDraft}
            targetPathPlaceholder={createDraft.sourceType === 'host-path' && createDraft.sourcePath ? createDraft.sourcePath : '/dvm-data/home/.codex'}
          />

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!createReady || isCreateBusy}
            className={`h-10 px-3 rounded text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${actionButtonClass(
              createReady && !isCreateBusy,
            )}`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {creatingSyncSet ? 'Creating…' : 'Create sync set'}
          </button>
        </div>

        <div className="dh-settings-section">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Existing sync sets
              </div>
              <div className="text-[var(--text-12)] text-[var(--muted)] mt-1">
                Full mirror mode. Files missing from the source are removed from targets on apply.
              </div>
            </div>
            <div className="text-[var(--text-11)] text-[var(--muted-dim)]">{syncSets.length} total</div>
          </div>

          {syncSetsLoading && syncSets.length === 0 ? (
            <div className="text-[var(--text-12)] text-[var(--muted-dim)]">Loading sync sets…</div>
          ) : syncSets.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--border-subtle)] bg-[var(--surface-softest)] px-4 py-5 text-[var(--text-12)] text-[var(--muted-dim)]">
              No sync sets yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {syncSets.map((syncSet) => {
                const editing = editingId === syncSet.id;
                const editDraft = editDrafts[syncSet.id] ?? buildSyncSetDraftFromSyncSet(syncSet);
                const saving = savingSyncSetId === syncSet.id;
                const deleting = deletingSyncSetId === syncSet.id;
                const applying = applyingSyncSetId === syncSet.id;
                const rowBusy = saving || deleting || applying || creatingSyncSet;
                const statusSummary = summarizeTargetStates(syncSet.targetStatus);
                const failedStatuses = syncSet.targetStatus.filter((status) => status.state === 'error').slice(0, 4);
                const editReady =
                  Boolean(String(editDraft.label).trim()) &&
                  Boolean(String(editDraft.targetPath).trim()) &&
                  (editDraft.sourceType === 'hub-managed' || Boolean(String(editDraft.sourcePath).trim()));

                return (
                  <div key={syncSet.id} className="dh-settings-row px-1 py-4">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-[16px] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
                              {syncSet.label}
                            </div>
                            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 py-0.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted)]">
                              {sourceTypeLabel(syncSet.sourceType)}
                            </span>
                            {syncSet.applyToHost ? (
                              <span className="rounded-full border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-0.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--accent)]">
                                Host target enabled
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2 text-[var(--text-11)] text-[var(--muted-dim)]">
                            <div className="break-all">
                              Source:{' '}
                              <span className="text-[var(--fg-secondary)]">
                                {syncSet.sourceType === 'hub-managed' ? syncSet.managedSourcePath : syncSet.sourcePath ?? 'Missing'}
                              </span>
                            </div>
                            <div className="break-all">
                              Target: <span className="text-[var(--fg-secondary)]">{syncSet.targetPath}</span>
                            </div>
                            <div>
                              Last applied version: <span className="text-[var(--fg-secondary)] font-mono">{shortVersion(syncSet.lastAppliedVersionId)}</span>
                            </div>
                            <div>
                              Last applied:{' '}
                              <span className="text-[var(--fg-secondary)]">
                                {syncSet.lastAppliedAt ? new Date(syncSet.lastAppliedAt).toLocaleString() : 'Never'}
                              </span>
                            </div>
                          </div>
                          {!syncSet.sourceExists ? (
                            <div className="mt-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
                              Source path is missing or unreadable. Apply will fail until the source exists again.
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!editing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  const confirmed = window.confirm(
                                    `Apply ${syncSet.label} to all existing drones${syncSet.applyToHost ? ' and host' : ''}?\n\nThis is a full mirror and will remove target files that are not present in the source.`,
                                  );
                                  if (!confirmed) return;
                                  void applySyncSetToExistingDrones(syncSet.id, syncSet.label);
                                }}
                                disabled={rowBusy || !syncSet.sourceExists}
                                className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${actionButtonClass(
                                  !rowBusy && syncSet.sourceExists,
                                )}`}
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                {applying ? 'Applying…' : 'Apply to existing drones'}
                              </button>
                              <button
                                type="button"
                                onClick={() => startEditing(syncSet)}
                                disabled={rowBusy}
                                className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${secondaryButtonClass(
                                  rowBusy,
                                )}`}
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const confirmed = window.confirm(`Delete sync set ${syncSet.label}?\n\nThis removes the saved definition and the hub-managed source directory if one exists.`);
                                  if (!confirmed) return;
                                  void deleteSyncSet(syncSet.id, syncSet.label);
                                }}
                                disabled={rowBusy}
                                className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                                  rowBusy
                                    ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                    : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                                }`}
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                {deleting ? 'Deleting…' : 'Delete'}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  const saved = await updateSyncSet(syncSet.id, editDraft);
                                  if (saved) cancelEditing(syncSet.id);
                                }}
                                disabled={!editReady || rowBusy}
                                className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${actionButtonClass(
                                  editReady && !rowBusy,
                                )}`}
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                {saving ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelEditing(syncSet.id)}
                                disabled={rowBusy}
                                className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${secondaryButtonClass(
                                  rowBusy,
                                )}`}
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {editing ? (
                        <SyncSetFields
                          draft={editDraft}
                          disabled={rowBusy}
                          onChange={(next) =>
                            setEditDrafts((current) => ({
                              ...current,
                              [syncSet.id]: next,
                            }))
                          }
                          targetPathPlaceholder={editDraft.sourceType === 'host-path' && editDraft.sourcePath ? editDraft.sourcePath : syncSet.targetPath}
                        />
                      ) : (
                        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-3">
                          <div className="dh-settings-subsection">
                            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Status</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className={`rounded-full border px-2 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${syncStatusBadgeClass('synced')}`}>
                                Synced {statusSummary.synced}
                              </span>
                              <span className={`rounded-full border px-2 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${syncStatusBadgeClass('error')}`}>
                                Errors {statusSummary.errors}
                              </span>
                              <span className={`rounded-full border px-2 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${syncStatusBadgeClass('idle')}`}>
                                Idle {statusSummary.idle}
                              </span>
                            </div>
                            <div className="mt-3 text-[var(--text-11)] text-[var(--muted-dim)]">
                              Recorded targets: {statusSummary.total || 0}
                            </div>
                          </div>

                          <div className="dh-settings-subsection">
                            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Recent target state</div>
                            {syncSet.targetStatus.length === 0 ? (
                              <div className="text-[var(--text-11)] text-[var(--muted-dim)]">
                                No recorded target state yet. New drones will still receive this sync set automatically.
                              </div>
                            ) : failedStatuses.length > 0 ? (
                              failedStatuses.map((status) => (
                                <div key={`${syncSet.id}-${status.targetId}`} className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2">
                                  <div className="text-[var(--text-11)] text-[var(--red)] font-[var(--weight-semibold)]">{status.targetName}</div>
                                  <div className="text-[var(--text-11)] text-[var(--muted)] mt-1 break-words">{status.error ?? 'Sync failed.'}</div>
                                </div>
                              ))
                            ) : (
                              syncSet.targetStatus.slice(0, 4).map((status) => (
                                <div
                                  key={`${syncSet.id}-${status.targetId}`}
                                  className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                                >
                                  <div className="text-[var(--text-11)] text-[var(--fg-secondary)]">{status.targetName}</div>
                                  <div className={`rounded-full border px-2 py-0.5 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${syncStatusBadgeClass(status.state)}`}>
                                    {status.state}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
