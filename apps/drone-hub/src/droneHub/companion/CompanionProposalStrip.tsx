import React from 'react';
import type { ProposalSummary } from '@drone/assistant-chat';

function proposalStatusSuffix(status: ProposalSummary['status']): string {
  if (status === 'failed') return ' · Failed';
  if (status === 'executing') return ' · Applying';
  return '';
}

/**
 * Numbered tabs for the pending proposals, attached to the top edge of the Companion window.
 * Horizontal so it never depends on the window's height, which can be a single row.
 * Pressing the reviewed number again asks the owner to hide or show its card.
 */
export function CompanionProposalStrip({
  proposals,
  selectedId,
  selectedOpen = true,
  onSelect,
}: {
  proposals: readonly ProposalSummary[];
  selectedId: string | null;
  selectedOpen?: boolean;
  onSelect(targetId: string): void;
}) {
  if (proposals.length === 0) return null;
  return (
    <nav
      aria-label="Pending proposals"
      className="flex max-w-[20rem] shrink-0 items-center gap-1 self-end rounded-t-lg border border-b-0 border-[var(--border)] bg-[var(--panel-raised)] px-1.5 pb-0.5 pt-1 shadow-[var(--edge-highlight)]"
    >
      <span className="shrink-0 px-1 text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">
        {proposals.length === 1 ? 'Proposal' : 'Proposals'}
      </span>
      <ol className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:h-0.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border)] [&::-webkit-scrollbar-track]:bg-transparent">
        {proposals.map((item, index) => {
          const selected = item.targetId === selectedId;
          const label = `Proposal ${index + 1}: ${item.title}${proposalStatusSuffix(item.status)}`;
          const tone = selected
            ? selectedOpen
              ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'border-[var(--accent-border)] bg-transparent text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
            : item.status === 'failed'
              ? 'border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
              : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]';
          return (
            <li key={item.targetId} className="shrink-0">
              <button
                type="button"
                aria-pressed={selected}
                aria-expanded={selected ? selectedOpen : undefined}
                aria-label={selected ? `${label}; ${selectedOpen ? 'hide' : 'show'} it` : label}
                title={selected ? `${selectedOpen ? 'Hide' : 'Show'} ${item.title}${proposalStatusSuffix(item.status)}` : `${item.title}${proposalStatusSuffix(item.status)}`}
                onClick={() => onSelect(item.targetId)}
                className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${tone} ${item.status === 'executing' ? 'animate-pulse' : ''}`}
              >
                {index + 1}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
