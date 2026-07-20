import React from 'react';

import type { SyncSet } from './settings-types';
import type { SyncSetDraftInput } from './use-sync-sets';

export const EMPTY_SYNC_SET_DRAFT: SyncSetDraftInput = {
  label: '',
  sourceType: 'host-path',
  sourcePath: '',
  targetPath: '',
  applyToHost: false,
};

export function cloneSyncSetDraft(draft?: Partial<SyncSetDraftInput> | null): SyncSetDraftInput {
  return {
    label: String(draft?.label ?? '').trimStart(),
    sourceType: draft?.sourceType === 'hub-managed' ? 'hub-managed' : 'host-path',
    sourcePath: String(draft?.sourcePath ?? ''),
    targetPath: String(draft?.targetPath ?? ''),
    applyToHost: draft?.applyToHost === true,
  };
}

export function buildSyncSetDraftFromSyncSet(syncSet: SyncSet): SyncSetDraftInput {
  return {
    label: syncSet.label,
    sourceType: syncSet.sourceType,
    sourcePath: syncSet.sourcePath ?? '',
    targetPath: syncSet.targetPath,
    applyToHost: syncSet.applyToHost,
  };
}

export function updateSyncSetDraftSourcePath(draft: SyncSetDraftInput, nextSourcePath: string): SyncSetDraftInput {
  const previousSourcePath = String(draft.sourcePath ?? '');
  const currentTargetPath = String(draft.targetPath ?? '');
  return {
    ...draft,
    sourcePath: nextSourcePath,
    targetPath: !currentTargetPath || currentTargetPath === previousSourcePath ? nextSourcePath : currentTargetPath,
  };
}

export function setSyncSetDraftSourceType(draft: SyncSetDraftInput, nextSourceType: SyncSet['sourceType']): SyncSetDraftInput {
  if (nextSourceType === 'hub-managed') {
    return {
      ...draft,
      sourceType: 'hub-managed',
      sourcePath: '',
    };
  }
  return {
    ...draft,
    sourceType: 'host-path',
    applyToHost: false,
  };
}

function formInputClass(disabled: boolean): string {
  return `h-10 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;
}

export function actionButtonClass(enabled: boolean): string {
  return enabled
    ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
    : 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]';
}

export function secondaryButtonClass(disabled: boolean): string {
  return disabled
    ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
    : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]';
}

export function SyncSetFields(props: {
  draft: SyncSetDraftInput;
  disabled: boolean;
  targetPathPlaceholder?: string;
  onChange: (next: SyncSetDraftInput) => void;
}) {
  const { draft, disabled, targetPathPlaceholder, onChange } = props;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <div className="flex flex-col gap-2 xl:col-span-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Label</div>
        <input
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
          className={formInputClass(disabled)}
          placeholder="Codex auth files"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Source type</div>
        <select
          value={draft.sourceType}
          onChange={(e) => onChange(setSyncSetDraftSourceType(draft, e.target.value === 'hub-managed' ? 'hub-managed' : 'host-path'))}
          className={formInputClass(disabled)}
          disabled={disabled}
        >
          <option value="host-path">Host directory</option>
          <option value="hub-managed">Hub-managed storage</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Target path</div>
        <input
          value={draft.targetPath}
          onChange={(e) => onChange({ ...draft, targetPath: e.target.value })}
          className={formInputClass(disabled)}
          placeholder={targetPathPlaceholder ?? '/dvm-data/home/.codex'}
          disabled={disabled}
          spellCheck={false}
        />
      </div>

      {draft.sourceType === 'host-path' ? (
        <div className="flex flex-col gap-2 xl:col-span-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Source path</div>
          <input
            value={draft.sourcePath}
            onChange={(e) => onChange(updateSyncSetDraftSourcePath(draft, e.target.value))}
            className={formInputClass(disabled)}
            placeholder="/Users/you/.codex"
            disabled={disabled}
            spellCheck={false}
          />
          <div className="text-[11px] text-[var(--muted-dim)]">
            Existing host directories are mirrored into every new drone automatically. Existing drones update only when you click apply.
          </div>
        </div>
      ) : (
        <div className="xl:col-span-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Hub-managed source</div>
          <div className="text-[11px] text-[var(--muted-dim)] mt-1 leading-relaxed">
            A dedicated source directory is created on the host for this sync set. New drones always receive a full mirror of that directory after provisioning.
          </div>
          <label className="mt-3 flex items-start gap-2 text-[12px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={draft.applyToHost}
              onChange={(e) => onChange({ ...draft, applyToHost: e.target.checked })}
              disabled={disabled}
              className="mt-[2px]"
            />
            <span>Apply this mirror to the host target path too.</span>
          </label>
        </div>
      )}
    </div>
  );
}
