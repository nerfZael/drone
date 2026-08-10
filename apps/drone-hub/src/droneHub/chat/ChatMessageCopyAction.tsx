import React from 'react';

import { copyText } from '../app/clipboard';
import { IconCopy } from './icons';

export function ChatMessageCopyAction({
  text,
  position = 'top',
  copyLabel = 'message',
}: {
  text: string;
  position?: 'top' | 'bottom' | 'inline' | 'hover-rail' | 'block' | 'code';
  copyLabel?: string;
}) {
  const [copiedValue, setCopiedValue] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const copied = copiedValue === text;

  React.useEffect(
    () => () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    },
    [],
  );

  if (!text) return null;

  return (
    <div
      className={
        position === 'inline' || position === 'hover-rail'
          ? 'relative z-20'
          : position === 'block' || position === 'code'
            ? 'absolute right-2 top-2 z-20'
            : `absolute right-2 z-20 ${position === 'top' ? 'top-2' : 'bottom-2'}`
      }
    >
      {copied ? (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none absolute whitespace-nowrap rounded border border-[var(--user-border)] bg-[var(--scrim-soft)] px-2 py-1 text-[var(--text-9)] uppercase tracking-wide text-[var(--fg-secondary)] ${
            position === 'hover-rail' ? 'bottom-full right-0 mb-1' : 'right-8 top-0'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Copied
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void copyText(text).then((didCopy) => {
            if (!didCopy) return;
            setCopiedValue(text);
            if (timerRef.current != null) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              setCopiedValue(null);
              timerRef.current = null;
            }, 1200);
          });
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] transition-opacity hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)] focus-visible:pointer-events-auto focus-visible:opacity-100 ${
          position === 'hover-rail'
            ? 'pointer-events-auto opacity-100'
            : position === 'block'
              ? 'pointer-events-none opacity-0 group-hover/markdown-block:pointer-events-auto group-hover/markdown-block:opacity-100'
              : position === 'code'
                ? 'dh-code-card__copy-button pointer-events-none opacity-0 group-hover/code-block:pointer-events-auto group-hover/code-block:opacity-100'
                : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
        }`}
        title={`Copy ${copyLabel}`}
        aria-label={`Copy ${copyLabel}`}
      >
        <IconCopy className="h-3.5 w-3.5 opacity-90" />
      </button>
    </div>
  );
}
