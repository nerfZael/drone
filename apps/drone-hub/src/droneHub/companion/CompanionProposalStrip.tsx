import React from 'react';
import type { ProposalSummary } from '@drone/assistant-chat';

export type CompanionProposalDisplayMode = 'summaries' | 'numbers';

function proposalStatusSuffix(status: ProposalSummary['status']): string {
  if (status === 'failed') return ' · Failed';
  if (status === 'executing') return ' · Applying';
  return '';
}

/** Pending proposals attached to the Companion window, with compact summaries by default. */
export function CompanionProposalStrip({
  proposals,
  selectedId,
  selectedOpen = true,
  edge = 'top',
  displayMode = 'summaries',
  onSelect,
}: {
  proposals: readonly ProposalSummary[];
  selectedId: string | null;
  selectedOpen?: boolean;
  edge?: 'top' | 'bottom';
  displayMode?: CompanionProposalDisplayMode;
  onSelect(targetId: string): void;
}) {
  if (proposals.length === 0) return null;
  const summaries = displayMode === 'summaries';
  return (
    <nav
      aria-label="Pending proposals"
      data-proposal-display={displayMode}
      className={`shrink-0 border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--edge-highlight)] ${
        summaries ? 'w-full' : 'flex max-w-[20rem] items-center gap-1 self-end px-1.5'
      } ${
        edge === 'bottom'
          ? `rounded-b-lg border-t-0 ${summaries ? '' : 'pb-1 pt-0.5'}`
          : `rounded-t-lg border-b-0 ${summaries ? '' : 'pb-0.5 pt-1'}`
      }`}
    >
      <span className={summaries ? 'sr-only' : 'shrink-0 px-1 text-[10px] uppercase tracking-wider text-[var(--muted-dim)]'}>
        {proposals.length === 1 ? 'Proposal' : 'Proposals'}
      </span>
      <ol className={summaries
        ? 'max-h-32 min-w-0 divide-y divide-[var(--border-subtle)] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]'
        : 'flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:h-0.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border)] [&::-webkit-scrollbar-track]:bg-transparent'}>
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
            <li key={item.targetId} className={summaries ? 'min-w-0' : 'shrink-0'}>
              <button
                type="button"
                aria-pressed={selected}
                aria-expanded={selected ? selectedOpen : undefined}
                aria-label={selected ? `${label}; ${selectedOpen ? 'hide' : 'show'} it` : label}
                title={selected ? `${selectedOpen ? 'Hide' : 'Show'} ${item.title}${proposalStatusSuffix(item.status)}` : `${item.title}${proposalStatusSuffix(item.status)}`}
                onClick={() => onSelect(item.targetId)}
                className={`${summaries
                  ? 'flex min-h-7 w-full min-w-0 items-center gap-2 border-0 px-2 py-1 text-left text-[11px] leading-4'
                  : 'inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-[11px] tabular-nums'
                } transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${tone} ${item.status === 'executing' ? 'animate-pulse' : ''}`}
              >
                {summaries ? (
                  <>
                    <span aria-hidden="true" className="w-4 shrink-0 text-right font-mono tabular-nums text-[var(--muted-dim)]">{index + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.status === 'failed' ? <span className="shrink-0 text-[10px] font-[var(--weight-semibold)] uppercase tracking-wide">Failed</span> : null}
                    {item.status === 'executing' ? <span className="shrink-0 text-[10px] font-[var(--weight-semibold)] uppercase tracking-wide">Applying</span> : null}
                  </>
                ) : index + 1}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
