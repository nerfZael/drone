import React from 'react';

export function formatWorkingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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
    <div className="text-[12.5px] font-semibold leading-[1.6] text-[var(--muted)]">
      <span>Working for {formatWorkingDuration(now - start)}</span>
    </div>
  );
}
