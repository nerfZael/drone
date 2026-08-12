import React from 'react';
import { agentRunLineChangeBreakdown, agentRunNetLineChangeLabel } from '@drone/assistant-chat';

export type ChangesLineSummaryCounts = {
  changed: number;
  additions: number;
  deletions: number;
  modified?: number;
};

type ChangesFileCountPillTone = 'accent' | 'staged' | 'unstaged';

const fileCountPillToneClass: Record<ChangesFileCountPillTone, string> = {
  accent: 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]',
  staged: 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]',
  unstaged: 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
};

export function ChangesFileCountPill({
  count,
  tone = 'accent',
}: {
  count: number;
  tone?: ChangesFileCountPillTone;
}) {
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border px-1.5 font-mono text-[var(--text-9)] font-[var(--weight-semibold)] leading-none tabular-nums ${fileCountPillToneClass[tone]}`}
    >
      {count}
    </span>
  );
}

export function ChangesLineSummary({ counts }: { counts: ChangesLineSummaryCounts }) {
  const lineChanges = agentRunLineChangeBreakdown(counts);
  const netLabel = agentRunNetLineChangeLabel(lineChanges.net);
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 px-1"
      aria-label={`${counts.changed} changed files, ${lineChanges.added} lines added, ${lineChanges.modified} lines modified, ${lineChanges.deleted} lines deleted, ${netLabel} net lines`}
    >
      <span className="sr-only">Changed files</span>
      <ChangesFileCountPill count={counts.changed} />
      <span className="flex items-center gap-1 font-mono text-[var(--text-9)] tabular-nums">
        <span className="text-[var(--green)]" title="Lines added">+{lineChanges.added}</span>
        <span className="text-[var(--yellow)]" title="Lines modified">~{lineChanges.modified}</span>
        <span className="text-[var(--red)]" title="Lines deleted">-{lineChanges.deleted}</span>
        <span className="text-[var(--muted-dim)]" aria-hidden="true">│</span>
        <span
          className="font-[var(--weight-semibold)] text-[var(--accent)]"
          title="Net line change"
        >
          {netLabel}
        </span>
      </span>
    </div>
  );
}
