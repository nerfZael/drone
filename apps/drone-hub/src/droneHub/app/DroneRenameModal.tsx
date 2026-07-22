import React from 'react';
import { IconRename } from '../overview/icons';
import { IconSpinner } from './icons';
import { validateDroneRename } from './drone-rename';

export type DroneRenameModalDrone = {
  id: string;
  currentName: string;
};

type DroneRenameModalProps = {
  busy?: boolean;
  drone: DroneRenameModalDrone;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
  onNameChange?: () => void;
};

export function DroneRenameModal({
  busy = false,
  drone,
  error = null,
  onCancel,
  onConfirm,
  onNameChange,
}: DroneRenameModalProps) {
  const [name, setName] = React.useState(drone.currentName);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const trimmedName = name.trim();
  const validationError = validateDroneRename(name, drone.currentName);
  const canSubmit = !busy && !validationError;

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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
      aria-labelledby="rename-drone-title"
      aria-describedby="rename-drone-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        className="w-full max-w-[460px] overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-overlay)] shadow-[0_28px_90px_var(--shadow-color)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onConfirm(trimmedName);
        }}
      >
        <div className="border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]">
              <IconRename className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div
                className="text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-[0.16em] text-[var(--muted-dim)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Drone details
              </div>
              <h2
                id="rename-drone-title"
                className="mt-2 text-[20px] font-[var(--weight-semibold)] leading-tight text-[var(--fg-strong)]"
              >
                Rename drone
              </h2>
              <p
                id="rename-drone-description"
                className="mt-2 text-[var(--text-13)] leading-6 text-[var(--muted)]"
              >
                Choose the name shown throughout Drone Hub.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <label
            htmlFor="rename-drone-name"
            className="text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Drone name
          </label>
          <input
            ref={inputRef}
            id="rename-drone-name"
            value={name}
            maxLength={80}
            disabled={busy}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? 'rename-drone-error rename-drone-hint' : 'rename-drone-hint'}
            onChange={(event) => {
              setName(event.target.value);
              onNameChange?.();
            }}
            className="mt-2 h-10 w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-13)] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)] focus:ring-1 focus:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div
            id="rename-drone-hint"
            className="mt-2 flex items-center justify-between gap-3 text-[var(--text-11)] text-[var(--muted-dim)]"
          >
            <span className="min-w-0 truncate font-mono" title={drone.id}>
              {drone.id}
            </span>
            <span className="flex-shrink-0">{name.length}/80</span>
          </div>
          {error ? (
            <div
              id="rename-drone-error"
              className="mt-3 rounded-[var(--radius-medium)] border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] leading-5 text-[var(--red)]"
            >
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`h-9 rounded px-3 text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] transition-all ${
              busy
                ? 'cursor-not-allowed border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-40'
                : 'border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            title={validationError ?? undefined}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] transition-all ${
              canSubmit
                ? 'border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--hover)]'
                : 'cursor-not-allowed border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-45'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {busy ? (
              <IconSpinner className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconRename className="h-3.5 w-3.5" />
            )}
            {busy ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </form>
    </div>
  );
}
