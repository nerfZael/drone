import React from 'react';
import { dirtyDroneApplyFileLabel, type DirtyDroneApplyModalState } from './dirty-drone-apply';

type DirtyDroneApplyModalProps = {
  busy?: boolean;
  dirtyDroneApplyModal: DirtyDroneApplyModalState;
  onCancel: () => void;
  onCommitAndApply: () => void;
  onKeepDirtyAndApply: () => void;
};

function actionCardClass(disabled: boolean): string {
  return disabled
    ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-50'
    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--fg-secondary)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,.05)]';
}

export function DirtyDroneApplyModal({
  busy = false,
  dirtyDroneApplyModal,
  onCancel,
  onCommitAndApply,
  onKeepDirtyAndApply,
}: DirtyDroneApplyModalProps) {
  const dirtyLabel = dirtyDroneApplyFileLabel(dirtyDroneApplyModal.dirtyFileCount);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Apply changes from ${dirtyDroneApplyModal.droneLabel}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-[640px] overflow-hidden rounded-[18px] border border-[var(--border-subtle)] bg-[rgba(12,16,24,.98)] shadow-[0_28px_90px_rgba(0,0,0,.46)]">
        <div className="border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Apply Changes
          </div>
          <div className="mt-2 text-[20px] font-semibold text-[var(--fg)]">Uncommitted drone changes detected</div>
          <div className="mt-2 text-[13px] leading-6 text-[var(--muted)]">
            <span className="font-medium text-[var(--fg-secondary)]">{dirtyDroneApplyModal.droneLabel}</span> has uncommitted changes (
            {dirtyLabel}). Choose whether to snapshot everything into a placeholder commit first, or continue and apply committed
            changes only.
          </div>
        </div>

        <div className="space-y-3 px-6 py-5">
          <button
            type="button"
            onClick={onKeepDirtyAndApply}
            disabled={busy}
            className={`w-full rounded-[16px] border px-4 py-4 text-left transition-all ${actionCardClass(busy)}`}
          >
            <div className="text-[13px] font-semibold text-[var(--fg)]">Apply committed changes only</div>
            <div className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
              Continue without creating a placeholder commit. Uncommitted edits stay in the drone workspace and are not applied.
            </div>
          </button>

          <button
            type="button"
            onClick={onCommitAndApply}
            disabled={busy}
            className={`w-full rounded-[16px] border px-4 py-4 text-left transition-all ${actionCardClass(busy)}`}
          >
            <div className="text-[13px] font-semibold text-[var(--fg)]">Commit all changes and apply</div>
            <div className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
              Stage all tracked and untracked edits, create a placeholder commit, then apply that snapshot to the host.
            </div>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`h-9 rounded px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all ${
              busy
                ? 'cursor-not-allowed border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-40'
                : 'border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
