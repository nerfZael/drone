import React from 'react';

type CanvasMessageBarProps = {
  selectedCount: number;
  selectedLabel?: string | null;
  expanded: boolean;
  sending: boolean;
  draft: string;
  error: string | null;
  inputRef: React.Ref<HTMLInputElement>;
  onExpand: () => void;
  onCollapse: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onInputBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
};

export function CanvasMessageBar({
  selectedCount,
  selectedLabel,
  expanded,
  sending,
  draft,
  error,
  inputRef,
  onExpand,
  onCollapse,
  onDraftChange,
  onSend,
  onInputBlur,
}: CanvasMessageBarProps) {
  if (selectedCount <= 0) return null;
  const fallbackLabel = selectedCount === 1 ? '1 drone' : `${selectedCount} drones`;
  const targetLabel = String(selectedLabel ?? '').trim() || fallbackLabel;
  const sendDisabled = sending || draft.trim().length === 0;

  return (
    <div
      data-canvas-message-bar="1"
      className="absolute left-1/2 bottom-3 z-20 -translate-x-1/2 w-[min(640px,calc(100%-1.5rem))]"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={onExpand}
          className="mx-auto flex items-center gap-2 h-8 px-3 rounded-md border border-[var(--accent-muted)] bg-[rgba(14,18,27,.94)] text-[11px] font-semibold text-[var(--accent)] shadow-[0_8px_22px_rgba(0,0,0,.35)] hover:bg-[var(--accent-subtle)] transition-colors"
          style={{ fontFamily: 'var(--display)' }}
          title={`Message ${targetLabel}`}
        >
          Message {targetLabel}
        </button>
      ) : (
        <div className="rounded-md border border-[var(--border)] bg-[rgba(14,18,27,.95)] p-2 shadow-[0_10px_28px_rgba(0,0,0,.4)]">
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              To {targetLabel}
            </span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onBlur={onInputBlur}
              onKeyDown={(event) => {
                if ((event.nativeEvent as any)?.isComposing) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSend();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  onCollapse();
                }
              }}
              placeholder={`Message ${targetLabel}...`}
              className="h-8 flex-1 min-w-0 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2.5 text-[12px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)]"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={sendDisabled}
              className={`h-8 px-3 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                sendDisabled
                  ? 'opacity-50 cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                  : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {sending ? 'Sending' : 'Send'}
            </button>
            <button
              type="button"
              onClick={onCollapse}
              className="h-8 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] transition-colors"
              style={{ fontFamily: 'var(--display)' }}
            >
              Close
            </button>
          </div>
          {error ? (
            <div className="mt-1 text-[10px] text-[var(--red)]" title={error}>
              {error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
