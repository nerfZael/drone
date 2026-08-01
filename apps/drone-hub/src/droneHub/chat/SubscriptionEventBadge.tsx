import React from 'react';

export function SubscriptionEventBadge() {
  return (
    <span
      className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      Automated event
    </span>
  );
}

export function isSubscriptionEventPrompt(prompt: unknown): boolean {
  return String(prompt ?? '')
    .trimStart()
    .startsWith('[event notification]');
}
