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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.58)] px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-drone-confirm-title"
      aria-describedby="delete-drone-confirm-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-lg border border-[rgba(255,95,95,.28)] bg-[rgba(12,16,24,.98)] shadow-[0_28px_90px_rgba(0,0,0,.48)]">
        <div className="border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-[rgba(255,95,95,.32)] bg-[rgba(255,80,80,.10)] text-[var(--red)]">
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
          <div className="max-h-[240px] overflow-auto rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)]">
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
                <div className="flex-shrink-0 rounded border border-[rgba(255,95,95,.24)] bg-[rgba(255,80,80,.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--red)]">
                  {archive ? 'Archive' : 'Delete'}
                </div>
              </div>
            ))}
          </div>
          {error ? (
            <div className="mt-3 rounded-lg border border-[rgba(255,90,90,.32)] bg-[rgba(255,80,80,.08)] px-3 py-2 text-[12px] leading-5 text-[var(--red)]">
              {error}
            </div>
          ) : null}
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
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || count === 0}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all ${
              busy || count === 0
                ? 'cursor-not-allowed border border-[rgba(255,95,95,.20)] bg-[rgba(255,80,80,.06)] text-[rgba(255,120,120,.45)]'
                : 'border border-[rgba(255,95,95,.42)] bg-[rgba(255,80,80,.14)] text-[var(--red)] hover:border-[rgba(255,120,120,.70)] hover:bg-[rgba(255,80,80,.20)]'
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
