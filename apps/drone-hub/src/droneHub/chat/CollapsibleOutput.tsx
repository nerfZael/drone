import React from 'react';
import { IconChevron } from './icons';

export function CollapsibleOutput({ text, ok }: { text: string; ok: boolean }) {
  const lines = React.useMemo(() => text.split('\n'), [text]);
  const total = lines.length;
  const defaultTailLines = 220;
  const isLong = total > defaultTailLines;
  const [showAll, setShowAll] = React.useState(!isLong);

  React.useEffect(() => {
    if (!isLong) setShowAll(true);
  }, [isLong]);

  const visibleLines = showAll ? lines : lines.slice(-defaultTailLines);
  const hidden = Math.max(0, total - visibleLines.length);

  return (
    <div className="relative">
      {!showAll && hidden > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[11px] text-[var(--muted-dim)]">
            {hidden} earlier line{hidden === 1 ? '' : 's'} hidden
          </div>
          <button
            onClick={() => setShowAll(true)}
            className="text-[11px] font-semibold text-[var(--accent)] hover:text-[var(--fg)] transition-colors"
          >
            Show all {total} lines
          </button>
        </div>
      )}

      <pre
        className={`whitespace-pre-wrap text-[12.5px] leading-[1.6] font-mono ${
          ok ? 'text-[var(--fg-secondary)]' : 'text-[var(--red)]'
        }`}
      >
        {visibleLines.join('\n') || (ok ? '(no output)' : '(failed)')}
      </pre>

      {showAll && isLong && (
        <button
          onClick={() => setShowAll(false)}
          className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:text-[var(--fg)] transition-colors"
        >
          <IconChevron down={false} />
          Collapse earlier lines
        </button>
      )}
    </div>
  );
}
