import React from 'react';
import { IconSpinner } from './icons';

type DraftCreateDroneModalProps = {
  open: boolean;
  draftCreating: boolean;
  draftCreateError: string | null;
  draftCreateName: string;
  onDraftCreateNameChange: (value: string) => void;
  draftCreateNameRef: React.Ref<HTMLInputElement>;
  draftNameSuggesting: boolean;
  draftSuggestedName: string;
  onUseSuggestedName: () => void;
  draftNameSuggestionError: string | null;
  draftCreateGroup: string;
  onDraftCreateGroupChange: (value: string) => void;
  onSubmit: () => void;
  onRequestClose: () => void;
};

export function DraftCreateDroneModal({
  open,
  draftCreating,
  draftCreateError,
  draftCreateName,
  onDraftCreateNameChange,
  draftCreateNameRef,
  draftNameSuggesting,
  draftSuggestedName,
  onUseSuggestedName,
  draftNameSuggestionError,
  draftCreateGroup,
  onDraftCreateGroupChange,
  onSubmit,
  onRequestClose,
}: DraftCreateDroneModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[420px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draftCreating) return;
            onSubmit();
          }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Name this drone
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5">
                Press Enter to create and continue.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (draftCreating) return;
                onRequestClose();
              }}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="px-5 py-4">
            {draftCreateError && (
              <div className="mb-3 p-2 rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] text-[11px] text-[var(--red)] whitespace-pre-wrap">
                {draftCreateError}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-[var(--muted)]">Drone name (dash-case)</span>
                <input
                  ref={draftCreateNameRef}
                  autoFocus
                  value={draftCreateName}
                  onChange={(e) => onDraftCreateNameChange(e.target.value)}
                  className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] font-mono text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                  placeholder="e.g. auth-bugfix"
                  disabled={draftCreating}
                />
                {draftNameSuggesting && (
                  <span
                    className="inline-flex items-center gap-2 self-start rounded-md border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1 text-[10px] font-semibold tracking-wide uppercase text-[var(--accent)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    <IconSpinner className="w-3.5 h-3.5 text-[var(--accent)]" />
                    Generating name suggestion
                  </span>
                )}
                {!draftNameSuggesting && draftSuggestedName && (
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-[var(--muted-dim)] truncate" title={draftSuggestedName}>
                      Suggested: <span className="font-mono text-[var(--fg-secondary)]">{draftSuggestedName}</span>
                    </span>
                    <button
                      type="button"
                      onClick={onUseSuggestedName}
                      disabled={draftCreating || draftCreateName.trim() === draftSuggestedName}
                      className={`h-6 px-2 rounded border font-semibold tracking-wide uppercase transition-all ${
                        draftCreating || draftCreateName.trim() === draftSuggestedName
                          ? 'opacity-50 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)] hover:brightness-110'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      {draftCreateName.trim() === draftSuggestedName ? 'Applied' : 'Use suggestion'}
                    </button>
                  </div>
                )}
                {!draftNameSuggesting && draftNameSuggestionError && (
                  <span className="text-[10px] text-[var(--muted-dim)]" title={draftNameSuggestionError}>
                    Name suggestion unavailable.
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-[var(--muted)]">Group (optional)</span>
                <input
                  value={draftCreateGroup}
                  onChange={(e) => onDraftCreateGroupChange(e.target.value)}
                  className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                  placeholder="e.g. auth, backend, infra"
                  disabled={draftCreating}
                />
              </label>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--panel-alt)] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onRequestClose}
              disabled={draftCreating}
              className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                draftCreating
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={draftCreating || !draftCreateName.trim()}
              className={`h-9 px-4 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                draftCreating || !draftCreateName.trim()
                  ? 'opacity-50 cursor-not-allowed bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {draftCreating ? 'Creating…' : 'Create drone'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
