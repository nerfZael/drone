import React from 'react';
import type { UseDeleteActionSettingsResult } from './use-delete-action-settings';

const ARCHIVE_RETENTION_OPTIONS: Array<{ value: '1h' | '8h' | '1d' | '1w'; label: string }> = [
  { value: '1h', label: '1 hour' },
  { value: '8h', label: '8 hours' },
  { value: '1d', label: '1 day' },
  { value: '1w', label: '1 week' },
];

const ARCHIVE_RUNTIME_POLICY_OPTIONS: Array<{ value: 'keep-running' | 'stop'; label: string }> = [
  { value: 'keep-running', label: 'Keep running in background' },
  { value: 'stop', label: 'Stop container on archive' },
];

type TrashBehaviorSettingsTabProps = {
  deleteAction: UseDeleteActionSettingsResult;
};

export function TrashBehaviorSettingsTab({ deleteAction }: TrashBehaviorSettingsTabProps) {
  const {
    deleteSettings,
    deleteSettingsLoading,
    deleteSettingsError,
    deleteSettingsNotice,
    deleteModeDraft,
    archiveRetentionDraft,
    archiveRuntimePolicyDraft,
    savingDeleteSettings,
    setDeleteModeDraft,
    setArchiveRetentionDraft,
    setArchiveRuntimePolicyDraft,
    saveDeleteSettings,
  } = deleteAction;

  const activeDeleteMode = deleteSettings?.deleteAction.mode ?? 'permanent';
  const deleteSettingsDirty =
    deleteModeDraft !== activeDeleteMode ||
    archiveRetentionDraft !== (deleteSettings?.deleteAction.archiveRetention ?? '1d') ||
    archiveRuntimePolicyDraft !== (deleteSettings?.deleteAction.archiveRuntimePolicy ?? 'keep-running');

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
      <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
        Trash behavior
      </div>
      <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
        Choose whether the trash button permanently deletes drones and chats now or archives them first.
      </div>
      <div className="text-[11px] text-[var(--muted-dim)]">
        Active mode: <span className="text-[var(--fg-secondary)]">{activeDeleteMode === 'archive' ? 'Archive' : 'Permanent delete'}</span>
      </div>
      {deleteSettingsError && (
        <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
          {deleteSettingsError}
        </div>
      )}
      {deleteSettingsNotice && (
        <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
          {deleteSettingsNotice}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDeleteModeDraft('permanent')}
          disabled={savingDeleteSettings || deleteSettingsLoading}
          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
            deleteModeDraft === 'permanent'
              ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
              : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
          } ${savingDeleteSettings || deleteSettingsLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Permanent delete
        </button>
        <button
          type="button"
          onClick={() => setDeleteModeDraft('archive')}
          disabled={savingDeleteSettings || deleteSettingsLoading}
          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
            deleteModeDraft === 'archive'
              ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
              : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
          } ${savingDeleteSettings || deleteSettingsLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Archive first
        </button>
      </div>

      {deleteModeDraft === 'archive' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 flex flex-col gap-2">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Archived runtime</div>
            <div className="text-[11px] text-[var(--muted-dim)]">Choose whether archived drones keep running until their retention window expires.</div>
            <select
              value={archiveRuntimePolicyDraft}
              onChange={(e) => setArchiveRuntimePolicyDraft(e.target.value as 'keep-running' | 'stop')}
              disabled={savingDeleteSettings || deleteSettingsLoading}
              className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
            >
              {ARCHIVE_RUNTIME_POLICY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 flex flex-col gap-2">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Retention window</div>
            <div className="text-[11px] text-[var(--muted-dim)]">Auto-delete archived drones and chats after the selected amount of time.</div>
            <select
              value={archiveRetentionDraft}
              onChange={(e) => setArchiveRetentionDraft(e.target.value as '1h' | '8h' | '1d' | '1w')}
              disabled={savingDeleteSettings || deleteSettingsLoading}
              className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
            >
              {ARCHIVE_RETENTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void saveDeleteSettings()}
          disabled={!deleteSettingsDirty || savingDeleteSettings || deleteSettingsLoading}
          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
            !deleteSettingsDirty || savingDeleteSettings || deleteSettingsLoading
              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
              : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          {savingDeleteSettings ? 'Saving…' : 'Save delete behavior'}
        </button>
      </div>
    </div>
  );
}
