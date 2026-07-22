import React from 'react';
import { stoppedRunDetail } from '@drone/assistant-chat';

import { RelativeTimeText } from './RelativeTimeText';

export function StoppedRunNotice({ reason, at }: { reason?: string; at?: string }) {
  return (
    <div
      role="status"
      aria-label={`Run stopped. ${stoppedRunDetail(reason)}`}
      className="my-2 flex max-w-[var(--chat-prose-max)] items-center gap-3 rounded-[var(--radius-medium)] border border-[var(--yellow-border)] bg-[var(--yellow-subtle)] px-3 py-2.5"
    >
      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-[var(--yellow-border)] bg-[var(--panel-overlay)] text-[var(--yellow)]">
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.25" fill="currentColor" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--yellow)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          Run stopped
        </span>
        <span className="mt-0.5 block text-[var(--text-10-5)] leading-[1.4] text-[var(--muted)]">
          {stoppedRunDetail(reason)}
        </span>
      </span>
      {at ? (
        <RelativeTimeText
          at={at}
          className="flex-none font-mono text-[var(--text-9)] text-[var(--muted-dim)]"
          title={new Date(at).toLocaleString()}
        />
      ) : null}
    </div>
  );
}
