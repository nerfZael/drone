import React from 'react';
import type { DroneDeleteMode } from './settings-types';
import { IconSpinner, IconTrash } from './icons';

export type DroneDeleteConfirmModalDrone = {
  id: string;
  label: string;
};

type DroneDeleteConfirmModalProps = {
  busy?: boolean;
  deleteMode: DroneDeleteMode;
  drones: DroneDeleteConfirmModalDrone[];
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DroneDeleteConfirmModal({
  busy = false,
  deleteMode,
  drones,
  error = null,
  onCancel,
  onConfirm,
}: DroneDeleteConfirmModalProps) {
  const count = drones.length;
  const archive = deleteMode === 'archive';
  const verb = archive ? 'Archive' : 'Delete';
  const actionText = busy ? `${archive ? 'Archiving' : 'Deleting'}...` : `${verb} ${count} drone${count === 1 ? '' : 's'}`;

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-drone-confirm-title"
      aria-describedby="delete-drone-confirm-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-lg border border-[var(--red-border)] bg-[var(--panel-overlay)] shadow-[0_28px_90px_var(--shadow-color)]">
        <div className="border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]">
              <IconTrash className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Confirm {archive ? 'Archive' : 'Delete'}
              </div>
              <h2 id="delete-drone-confirm-title" className="mt-2 text-[20px] font-semibold leading-tight text-[var(--fg)]">
                {verb} {count} selected drone{count === 1 ? '' : 's'}?
              </h2>
              <p id="delete-drone-confirm-description" className="mt-2 text-[13px] leading-6 text-[var(--muted)]">
                {archive
                  ? 'This removes the selected drones from the active list now. You can restore them from Settings > Archive before they auto-delete.'
                  : 'This removes the selected drone containers and removes them from your registry.'}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="max-h-[240px] overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-soft)]">
            {drones.map((drone, index) => (
              <div
                key={drone.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                  index === 0 ? '' : 'border-t border-[var(--border-subtle)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[var(--fg)]">{drone.label}</div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--muted-dim)]">{drone.id}</div>
                </div>
                <div className="flex-shrink-0 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--red)]">
                  {archive ? 'Archive' : 'Delete'}
                </div>
              </div>
            ))}
          </div>
          {error ? (
            <div className="mt-3 rounded-lg border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] leading-5 text-[var(--red)]">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`h-9 rounded px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all ${
              busy
                ? 'cursor-not-allowed border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-40'
                : 'border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || count === 0}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all ${
              busy || count === 0
                ? 'cursor-not-allowed border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] opacity-45'
                : 'border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] hover:border-[var(--red)] hover:bg-[var(--danger-panel)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {busy ? <IconSpinner className="h-3.5 w-3.5 animate-spin" /> : <IconTrash className="h-3.5 w-3.5" />}
            {actionText}
          </button>
        </div>
      </div>
    </div>
  );
}
