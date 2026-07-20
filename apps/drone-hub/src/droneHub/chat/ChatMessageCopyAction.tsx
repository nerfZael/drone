import React from 'react';

import { copyText } from '../app/clipboard';
import { IconCopy } from './icons';

export function ChatMessageCopyAction({
  text,
  position = 'top',
}: {
  text: string;
  position?: 'top' | 'bottom' | 'inline';
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
        position === 'inline'
          ? 'relative z-20'
          : `absolute right-2 z-20 ${position === 'top' ? 'top-2' : 'bottom-2'}`
      }
    >
      {copied ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-8 top-0 rounded border border-[var(--user-border)] bg-[var(--scrim-soft)] px-2 py-1 text-[var(--text-9)] uppercase tracking-wide text-[var(--fg-secondary)]"
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
        className="pointer-events-none inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)] focus-visible:pointer-events-auto focus-visible:opacity-100"
        title="Copy message"
        aria-label="Copy message"
      >
        <IconCopy className="h-3.5 w-3.5 opacity-90" />
      </button>
    </div>
  );
}
