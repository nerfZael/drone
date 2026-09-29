import React from 'react';

export function ChatExecutionNotice({ text }: { text?: string }) {
  return text ? <div className="my-2 text-11 text-[var(--muted)]">{text}</div> : null;
}

export function EarlierRequestWorkingNotice({ id, prompt }: { id: string; prompt: string }) {
  return (
    <button
      type="button"
      aria-label={`Show active request: ${prompt}`}
      className="my-2 block w-full rounded border border-[var(--border-subtle)] px-3 py-2 text-left text-12 text-[var(--muted)]"
      onClick={(event) => {
        const surface = event.currentTarget.closest('[data-chat-transcript-surface]') ?? event.currentTarget.parentElement?.parentElement;
        const target = Array.from(surface?.querySelectorAll('[data-pending-prompt-id]') ?? [])
          .find((node) => node.getAttribute('data-pending-prompt-id') === id);
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }}
    >
      <span className="block">Working on this request · Show request</span>
      <span className="mt-1 block truncate text-11 text-[var(--muted)]">{prompt}</span>
    </button>
  );
}
