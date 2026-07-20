import React from 'react';
import type { AgentPlan } from '../types';
import { IconCheck, IconChevron, IconSpinner } from './icons';

const DEFAULT_VISIBLE_ITEMS = 8;

export function AgentPlanList({
  plan,
  running = false,
  className = '',
  headerActions,
}: {
  plan?: AgentPlan;
  running?: boolean;
  className?: string;
  headerActions?: React.ReactNode;
}) {
  const [planExpanded, setPlanExpanded] = React.useState(running);
  const [stepsExpanded, setStepsExpanded] = React.useState(false);
  if (!plan?.items.length) return null;
  const completed = plan.items.filter((item) => item.status === 'completed').length;
  const hasHiddenItems = plan.items.length > DEFAULT_VISIBLE_ITEMS;
  const showPlanItems = running || planExpanded;
  const visibleItems = stepsExpanded ? plan.items : plan.items.slice(0, DEFAULT_VISIBLE_ITEMS);
  const progressLabel = `${completed}/${plan.items.length}`;

  return (
    <section
      className={`mt-2.5 border-t border-[var(--border-subtle)] pt-2.5 ${className}`}
      aria-label="Plan"
    >
      <div className={`${showPlanItems ? 'mb-2' : ''} flex min-h-7 items-center justify-between gap-3`}>
        <div className="min-w-0">
          {running ? (
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[var(--text-10)] font-medium text-[var(--muted)]"
              >
                Plan
              </span>
              <span className="font-mono text-[var(--text-9)] tabular-nums text-[var(--muted-dim)]">
                ({progressLabel})
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPlanExpanded((value) => !value)}
              className="flex items-center gap-1 text-[var(--text-10)] font-medium text-[var(--muted)] transition-colors hover:text-[var(--accent)] focus-visible:text-[var(--accent)] focus-visible:outline-none"
              aria-expanded={planExpanded}
            >
              <IconChevron down={planExpanded} />
              <span>{planExpanded ? 'Hide plan' : 'Show plan'}</span>
              <span className="font-mono font-normal tabular-nums tracking-normal text-[var(--muted-dim)]">
                ({progressLabel})
              </span>
            </button>
          )}
        </div>
        {headerActions ? <div className="flex shrink-0 items-center gap-1">{headerActions}</div> : null}
      </div>
      {showPlanItems ? (
        <>
          <ol className="space-y-1.5">
            {visibleItems.map((item, index) => {
              const done = item.status === 'completed';
              const active = item.status === 'in_progress';
              const cancelled = item.status === 'cancelled';
              return (
                <li
                  key={item.id || `${index}:${item.text}`}
                  className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 text-[var(--text-11)] leading-[1.45]"
                >
                  <span className="mt-[1px] flex h-4 w-4 items-center justify-center" aria-hidden="true">
                    {done ? (
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]">
                        <IconCheck className="h-2.5 w-2.5" />
                      </span>
                    ) : active && running ? (
                      <IconSpinner className="h-3.5 w-3.5 text-[var(--accent)]" />
                    ) : active ? (
                      <span className="h-2 w-2 rounded-full border border-[var(--accent)] bg-[var(--accent-subtle)]" />
                    ) : (
                      <span className={`h-2 w-2 rounded-full border ${cancelled ? 'border-[var(--muted-dim)] opacity-45' : 'border-[var(--accent-muted)]'}`} />
                    )}
                  </span>
                  <span
                    className={
                      done
                        ? 'break-words text-[var(--muted-dim)] line-through decoration-[var(--muted)]'
                        : cancelled
                          ? 'break-words text-[var(--muted-dim)] line-through opacity-60'
                          : active
                            ? 'break-words font-medium text-[var(--fg)]'
                            : 'break-words text-[var(--fg-secondary)]'
                    }
                  >
                    <span className="sr-only">{done ? 'Completed: ' : cancelled ? 'Cancelled: ' : active ? 'In progress: ' : 'Pending: '}</span>
                    {item.text}
                  </span>
                </li>
              );
            })}
          </ol>
          {hasHiddenItems ? (
            <button
              type="button"
              onClick={() => setStepsExpanded((value) => !value)}
              className="mt-2 text-[var(--text-10)] font-medium text-[var(--muted)] transition-colors hover:text-[var(--accent)] focus-visible:text-[var(--accent)] focus-visible:outline-none"
              aria-expanded={stepsExpanded}
            >
              {stepsExpanded ? 'Show fewer steps' : `Show ${plan.items.length - DEFAULT_VISIBLE_ITEMS} more`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
