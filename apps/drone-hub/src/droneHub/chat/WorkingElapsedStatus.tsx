import React from 'react';

type AgentRunSummaryLineProps = {
  active: boolean;
  durationMs: number;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
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
  detail,
  trailing,
  expanded,
  onToggle,
}: AgentRunSummaryLineProps) {
  const label = `${active ? 'Working' : 'Worked'} for ${formatWorkingDuration(durationMs)}`;
  const content = (
    <>
      <span
        className="text-sm font-[var(--weight-semibold)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {label}
      </span>
      {detail ? <span className="text-xs text-[var(--muted-dim)]">{detail}</span> : null}
      {trailing ? <span className="text-[var(--muted-dim)]">{trailing}</span> : null}
    </>
  );
  const className =
    'flex min-h-9 w-full items-center gap-2 border-b border-[var(--border-subtle)] py-1.5 text-left text-[var(--muted)]';

  if (onToggle) {
    return (
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse tool calls' : 'Expand tool calls'}
        onClick={onToggle}
        className={`${className} hover:text-[var(--fg-secondary)]`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

export function WorkingElapsedStatus({ startedAt }: { startedAt?: string | number | null }) {
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
    <div className="text-[var(--text-12-5)] font-[var(--weight-semibold)] leading-[1.6] text-[var(--muted)]">
      <span>Working for {formatWorkingDuration(now - start)}</span>
    </div>
  );
}
