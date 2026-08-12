import React from 'react';

import { RelativeTimeText } from './RelativeTimeText';

type AgentRunSummaryLineProps = {
  active: boolean;
  durationMs: number;
  preRunDurationMs?: number;
  label?: string;
  tone?: 'default' | 'approval';
  at?: string;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
};

export function formatWorkingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function AgentRunSummaryLine({
  active,
  durationMs,
  preRunDurationMs,
  label,
  tone = 'default',
  at,
  detail,
  trailing,
  expanded,
  onToggle,
  toggleLabel = 'tool calls',
}: AgentRunSummaryLineProps) {
  const normalizedPreRunDurationMs =
    Number.isFinite(preRunDurationMs) ? Math.max(0, Number(preRunDurationMs)) : 0;
  const showPreRunDuration = normalizedPreRunDurationMs >= 1_000;
  const summaryLabel =
    label ??
    (showPreRunDuration
      ? `${active ? 'Working for' : 'Completed in'} ${formatWorkingDuration(normalizedPreRunDurationMs + durationMs)}`
      : `${active ? 'Working' : 'Worked'} for ${formatWorkingDuration(durationMs)}`);
  const content = (
    <>
      <span
        className={`text-sm font-[var(--weight-semibold)] ${
          tone === 'approval' ? 'text-[var(--yellow)]' : ''
        }`}
        style={{ fontFamily: 'var(--display)' }}
      >
        {summaryLabel}
      </span>
      {detail ? <span className="text-xs text-[var(--muted-dim)]">{detail}</span> : null}
      {at ? (
        <RelativeTimeText
          at={at}
          className="ml-auto font-mono text-[var(--text-9)] leading-none text-[var(--chat-message-time)] opacity-0 transition-opacity group-hover/turn:opacity-100 group-focus-within/turn:opacity-100"
          title={new Date(at).toLocaleString()}
        />
      ) : null}
      {trailing ? <span className="text-[var(--muted-dim)]">{trailing}</span> : null}
    </>
  );
  const className =
    'flex min-h-9 w-full items-center gap-2 border-b border-[var(--border-subtle)] py-1.5 text-left text-[var(--muted)] max-w-[var(--chat-prose-max)]';

  if (onToggle) {
    return (
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${toggleLabel}`}
        onClick={onToggle}
        className={`${className} hover:text-[var(--fg-secondary)]`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

export function WorkingElapsedStatus({
  startedAt,
  preRunDurationMs,
}: {
  startedAt?: string | number | null;
  preRunDurationMs?: number;
}) {
  const fallbackStart = React.useRef(Date.now()).current;
  const parsedStart =
    typeof startedAt === 'number' ? startedAt : Date.parse(String(startedAt ?? ''));
  const start = Number.isFinite(parsedStart) ? parsedStart : fallbackStart;
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <AgentRunSummaryLine
      active
      durationMs={now - start}
      preRunDurationMs={preRunDurationMs}
    />
  );
}

export function CreatingNewChatStatus() {
  return (
    <div role="status" aria-live="polite">
      <AgentRunSummaryLine
        active
        durationMs={0}
        label="Creating a new chat"
        trailing={
          <svg
            className="h-3 w-3 animate-spin motion-reduce:animate-none"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="6"
              cy="6"
              r="4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.25"
            />
            <path
              d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        }
      />
    </div>
  );
}
