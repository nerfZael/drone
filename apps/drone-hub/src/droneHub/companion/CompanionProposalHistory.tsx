import React from 'react';

import type { CompanionProposalHistoryEntry } from './CompanionContext';
import { CompanionProposalCard } from './CompanionProposalCard';

function executionStatus(entry: CompanionProposalHistoryEntry): {
  label: string;
  className: string;
} {
  if (entry.execution.ok) {
    return { label: 'Applied', className: 'text-[var(--green)]' };
  }
  const partiallyApplied = entry.execution.operations.some(
    (operation) => operation.status === 'completed',
  );
  return partiallyApplied
    ? { label: 'Partially applied', className: 'text-[var(--yellow)]' }
    : { label: 'Failed', className: 'text-[var(--red)]' };
}

export function CompanionProposalHistory({
  entries,
  onClose,
}: {
  entries: CompanionProposalHistoryEntry[];
  onClose(): void;
}) {
  const [selectedEntryId, setSelectedEntryId] = React.useState<string | null>(null);
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;

  React.useEffect(() => {
    if (selectedEntryId && !selectedEntry) setSelectedEntryId(null);
  }, [selectedEntry, selectedEntryId]);

  if (selectedEntry) {
    return (
      <CompanionProposalCard
        key={selectedEntry.id}
        proposal={selectedEntry.proposal}
        defaultRepoPath={selectedEntry.defaultRepoPath}
        execution={selectedEntry.execution}
        executing={false}
        companionStatus="completed"
        droneNames={selectedEntry.droneNames}
        historyDetails={{
          startedAt: selectedEntry.startedAt,
          completedAt: selectedEntry.completedAt,
          autoApproved: selectedEntry.autoApproved,
          onBack: () => setSelectedEntryId(null),
        }}
      />
    );
  }

  return (
    <aside
      id="companion-proposal-history"
      className="flex max-h-[min(36rem,calc(100vh-2rem))] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl min-[860px]:w-[22rem] min-[1100px]:w-[26rem]"
      aria-label="Companion execution history"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-[var(--weight-semibold)] text-[var(--fg)]">
            Execution history
          </div>
          <div className="text-[10px] text-[var(--muted)]">
            Completed proposals from this session
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-lg text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          aria-label="Close execution history"
          title="Close execution history"
        >
          ×
        </button>
      </div>
      <div className="dh-agent-activity-scrollbar min-h-0 flex-1 overflow-y-auto p-2.5">
        <div className="space-y-2">
          {[...entries].reverse().map((entry) => {
            const status = executionStatus(entry);
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedEntryId(entry.id)}
                aria-label={`Open execution details for ${entry.proposal.title}`}
                className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 py-2 text-left outline-none transition-colors hover:bg-[var(--panel-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-[var(--weight-semibold)] ${status.className}`}>
                    {status.label}
                  </span>
                  {entry.autoApproved ? (
                    <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[9px] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)]">
                      Auto
                    </span>
                  ) : null}
                  <time
                    dateTime={new Date(entry.completedAt).toISOString()}
                    className="ml-auto text-[10px] tabular-nums text-[var(--muted-dim)]"
                  >
                    {new Date(entry.completedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </time>
                </div>
                <div className="mt-1 truncate text-xs font-[var(--weight-medium)] text-[var(--fg-secondary)]">
                  {entry.proposal.title}
                </div>
                {entry.proposal.summary ? (
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-[var(--muted)]">
                    {entry.proposal.summary}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
