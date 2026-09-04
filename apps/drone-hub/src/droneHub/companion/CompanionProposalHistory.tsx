import React from 'react';
import {
  companionProposalOperationLabel,
  type CompanionProposalOperation,
} from '@drone/assistant-chat';

import type { CompanionProposalHistoryEntry } from './CompanionContext';

function historyDroneLabel(entry: CompanionProposalHistoryEntry, droneId: string): string {
  if (!droneId.startsWith('$')) return entry.droneNames[droneId] || droneId;
  const source = entry.proposal.operations.find((operation) =>
    (operation.type === 'create_drone' || operation.type === 'clone_drone') &&
    operation.id === droneId.slice(1),
  );
  return source?.type === 'create_drone'
    ? source.name || 'New drone'
    : source?.type === 'clone_drone'
      ? source.name
      : droneId;
}

function historyOperationLabel(
  entry: CompanionProposalHistoryEntry,
  operation: CompanionProposalOperation,
): string {
  return companionProposalOperationLabel(
    operation,
    'droneId' in operation ? historyDroneLabel(entry, operation.droneId) : '',
  );
}

export function CompanionProposalHistory({
  entries,
  onClose,
}: {
  entries: CompanionProposalHistoryEntry[];
  onClose(): void;
}) {
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
            {entries.length} {entries.length === 1 ? 'proposal' : 'proposals'} this session
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
          {[...entries].reverse().map((entry, entryIndex) => {
            const completedCount = entry.execution.operations.filter(
              (operation) => operation.status === 'completed',
            ).length;
            const statusLabel = entry.execution.ok
              ? 'Applied'
              : completedCount > 0
                ? 'Partially applied'
                : 'Failed';
            const statusClass = entry.execution.ok
              ? 'text-[var(--green)]'
              : completedCount > 0
                ? 'text-[var(--yellow)]'
                : 'text-[var(--red)]';
            const resultById = new Map(
              entry.execution.operations.map((operation) => [operation.id, operation]),
            );
            return (
              <details
                key={entry.id}
                open={entryIndex === 0}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-soft)]"
              >
                <summary className="cursor-pointer list-none px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-[var(--weight-semibold)] ${statusClass}`}>
                      {statusLabel}
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
                </summary>
                <ol className="border-t border-[var(--border-subtle)] px-3 py-2">
                  {entry.proposal.operations.map((operation, index) => {
                    const result = resultById.get(operation.id);
                    return (
                      <li key={operation.id} className="flex gap-2 py-1.5 text-[11px] first:pt-0 last:pb-0">
                        <span
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                            result?.status === 'completed'
                              ? 'bg-[var(--green)]'
                              : result?.status === 'failed'
                                ? 'bg-[var(--red)]'
                                : 'bg-[var(--muted-dim)]'
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-[var(--fg-secondary)]">
                            <span className="mr-1 text-[var(--muted-dim)]">{index + 1}.</span>
                            {historyOperationLabel(entry, operation)}
                          </div>
                          {result?.error ? (
                            <div className="mt-0.5 break-words text-[var(--red)]">{result.error}</div>
                          ) : null}
                          {result?.result ? (
                            <details className="mt-0.5 text-[10px] text-[var(--muted)]">
                              <summary className="cursor-pointer">Result</summary>
                              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                                {JSON.stringify(result.result, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </details>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
