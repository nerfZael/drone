import React from 'react';

const useClientLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function QueuedNewChatLabel({
  failed = false,
  surface = 'user',
}: {
  failed?: boolean;
  surface?: 'user' | 'neutral';
}) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-t-[var(--radius-medium)] border border-b-0 px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] ${
        failed
          ? 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]'
          : surface === 'neutral'
            ? 'border-[color-mix(in_srgb,var(--accent)_24%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--accent)_11%,var(--surface-soft))] text-[var(--fg-secondary)]'
            : 'border-[color-mix(in_srgb,var(--accent)_24%,var(--user-bubble-border))] bg-[color-mix(in_srgb,var(--accent)_11%,var(--user-bubble))] text-[var(--fg-secondary)]'
      }`}
      style={{ fontFamily: 'var(--display)' }}
    >
      {failed ? 'New chat failed' : 'New chat'}
    </span>
  );
}

export function CreateNewChatNowButton({
  busy = false,
  disabled = false,
  autoFocus = false,
  onAutoFocusComplete,
  onClick,
}: {
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onAutoFocusComplete?: () => void;
  onClick: () => void;
}) {
  const localRef = React.useRef<HTMLButtonElement | null>(null);
  const didAutoFocusRef = React.useRef(false);

  useClientLayoutEffect(() => {
    if (!autoFocus) {
      didAutoFocusRef.current = false;
      return;
    }
    if (disabled || didAutoFocusRef.current) return;
    const button = localRef.current;
    button?.focus();
    if (!button || document.activeElement !== button) return;
    didAutoFocusRef.current = true;
    onAutoFocusComplete?.();
  }, [autoFocus, disabled, onAutoFocusComplete]);

  React.useEffect(() => {
    const dismissFocus = (event: PointerEvent) => {
      const button = localRef.current;
      if (!button || document.activeElement !== button) return;
      if (event.composedPath().includes(button)) return;
      button.blur();
    };
    document.addEventListener('pointerdown', dismissFocus, true);
    return () => document.removeEventListener('pointerdown', dismissFocus, true);
  }, []);

  return (
    <button
      ref={localRef}
      type="button"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
          return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.currentTarget.disabled) event.currentTarget.click();
      }}
      disabled={disabled}
      aria-keyshortcuts="Enter Escape"
      className="inline-flex min-h-7 items-center rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--surface-strong)] px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] shadow-sm transition-[background-color,border-color,color,box-shadow] hover:border-[var(--accent-muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? 'Creating…' : 'Create now'}
    </button>
  );
}
