import React from 'react';
import type { BlipCompactionHistoryDetails, BlipContextUsage } from '@blip/protocol';

function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en', {
    notation: tokens >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Math.max(0, Math.round(tokens)));
}

function formatTimestamp(timestamp: string | number | undefined): string {
  if (timestamp === undefined) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AssistantCompactionRow({
  details,
  timestamp,
}: {
  details: BlipCompactionHistoryDetails;
  timestamp?: string | number;
}) {
  const after =
    details.tokensAfter === null
      ? 'size unavailable'
      : `${formatTokens(details.tokensAfter)} tokens`;
  const at = formatTimestamp(timestamp);
  const title = [
    details.trigger === 'manual' ? 'Manual compaction' : 'Automatic compaction',
    `${formatTokens(details.tokensBefore)} → ${after}`,
    details.fallbackReason,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-assistant-compaction="true"
      className="flex items-center justify-center gap-2 py-1 text-[var(--text-10)] text-[var(--muted-dim)]"
      title={title}
    >
      <span className="h-px min-w-4 flex-1 bg-[var(--border-subtle)]" aria-hidden="true" />
      <span className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
        <span className="font-medium text-[var(--muted)]">Context compacted</span>
        <span className="font-mono tabular-nums">
          {formatTokens(details.tokensBefore)} → {after}
        </span>
        <span>· {details.trigger === 'manual' ? 'Manual' : 'Automatic'}</span>
        {details.fallbackUsed ? <span>· Fallback summary</span> : null}
        {at ? <span>· {at}</span> : null}
      </span>
      <span className="h-px min-w-4 flex-1 bg-[var(--border-subtle)]" aria-hidden="true" />
    </div>
  );
}

export function AssistantCompactionWorkingRow() {
  return (
    <div
      data-assistant-compaction-working="true"
      className="flex items-center justify-center gap-2 py-1 text-[var(--text-10)] font-medium text-[var(--accent)]"
      role="status"
      aria-live="polite"
    >
      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".25" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      Compacting context…
    </div>
  );
}

export function AssistantContextUsageIndicator({ usage }: { usage: BlipContextUsage }) {
  const percent = Math.max(0, usage.percent);
  const visiblePercent = Math.min(100, percent);
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - visiblePercent / 100);
  const tone =
    percent >= 90
      ? 'text-[var(--red)]'
      : percent >= 75
        ? 'text-[var(--yellow)]'
        : 'text-[var(--accent)]';
  const confidence = usage.confidence === 'heuristic' ? ', estimated' : '';
  const label = `Context: ${formatTokens(usage.tokens)} of ${formatTokens(usage.contextWindow)} tokens (${Math.round(percent)}%${confidence})`;

  return (
    <span
      data-assistant-context-usage="true"
      className={`relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center ${tone}`}
      title={label}
      aria-label={label}
      role="img"
    >
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <circle
          cx="15"
          cy="15"
          r={radius}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth="3"
        />
        <circle
          cx="15"
          cy="15"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 15 15)"
        />
      </svg>
      <span className="absolute text-[.5rem] font-semibold tabular-nums text-[var(--chat-composer-fg)]">
        {Math.round(percent)}
      </span>
    </span>
  );
}
