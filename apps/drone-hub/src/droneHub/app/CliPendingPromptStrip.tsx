import React from 'react';
import { timeAgo } from '../../domain';
import type { PendingPrompt } from '../types';
import { TypingDots } from '../overview/icons';

function pendingStatusLabel(state: PendingPrompt['state']): string {
  return state === 'queued' ? 'Queued' : state === 'sending' ? 'Sending' : state === 'failed' ? 'Failed' : 'Waiting';
}

export const CliPendingPromptStrip = React.memo(function CliPendingPromptStrip({
  items,
  nowMs,
}: {
  items: PendingPrompt[];
  nowMs: number;
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="flex-shrink-0 px-5 pt-2">
      <div className="max-w-[1170px] mx-auto flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={`cli-pending:${item.id}`}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {pendingStatusLabel(item.state)}
                  <TypingDots color="var(--accent)" />
                </span>
                <span className="truncate text-[12px] text-[var(--fg-secondary)]">
                  {String(item.prompt ?? '').trim() || '[pending prompt]'}
                </span>
              </div>
              <span
                className="flex-shrink-0 text-[9px] leading-none text-[var(--muted-dim)] font-mono"
                title={new Date(item.at).toLocaleString()}
              >
                {timeAgo(item.at, nowMs)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
