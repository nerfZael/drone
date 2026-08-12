import React from 'react';
import { agentRunNetLineChangeLabel } from '@drone/assistant-chat';

import { UiButton, UiPanelToolbar, UiToolbarInput } from '../../ui/components';
import { cn } from '../../ui/cn';

export type UnifiedRequestState = 'open' | 'merged' | 'closed' | 'draft';

export type UnifiedRequestListItem = {
  number: number;
  title: string;
  state: UnifiedRequestState;
  stateLabel?: string;
  metadata: React.ReactNode;
  signals?: React.ReactNode;
  lineStats?: {
    files: number;
    additions: number;
    modifications: number;
    deletions: number;
    total: number;
  } | null;
  updatedAt?: string | null;
  externalHref?: string | null;
  selectionDisabled?: boolean;
};

export type UnifiedRequestFilter = {
  value: string;
  label: string;
  count: number;
};

export type UnifiedRequestBulkAction = {
  label: string;
  title: string;
  tone: 'success' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
};

export function UnifiedRequestList({
  ariaLabel,
  items,
  selectedNumbers,
  onSelectedNumbersChange,
  onOpenRequest,
  query,
  onQueryChange,
  queryPlaceholder,
  filters,
  activeFilter,
  onFilterChange,
  toolbarTrailing,
  emptyTitle = 'No matching requests',
  emptyDescription = 'Try a different search or status filter.',
  mergeAction,
  closeAction,
}: {
  ariaLabel: string;
  items: UnifiedRequestListItem[];
  selectedNumbers: ReadonlySet<number>;
  onSelectedNumbersChange: (numbers: Set<number>) => void;
  onOpenRequest: (number: number) => void;
  query: string;
  onQueryChange: (query: string) => void;
  queryPlaceholder: string;
  filters: UnifiedRequestFilter[];
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  toolbarTrailing?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  mergeAction: UnifiedRequestBulkAction;
  closeAction: UnifiedRequestBulkAction;
}) {
  const [, refreshRelativeTimes] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    if (!items.some((item) => item.updatedAt)) return;
    const timer = window.setInterval(refreshRelativeTimes, 30_000);
    return () => window.clearInterval(timer);
  }, [items]);

  const selectableNumbers = items
    .filter((item) => !item.selectionDisabled)
    .map((item) => item.number);
  const selectedVisibleCount = selectableNumbers.filter((number) =>
    selectedNumbers.has(number),
  ).length;
  const allVisibleSelected =
    selectableNumbers.length > 0 && selectedVisibleCount === selectableNumbers.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedNumbers);
    for (const number of selectableNumbers) {
      if (checked) next.add(number);
      else next.delete(number);
    }
    onSelectedNumbersChange(next);
  };

  const toggleOne = (number: number, checked: boolean) => {
    const next = new Set(selectedNumbers);
    if (checked) next.add(number);
    else next.delete(number);
    onSelectedNumbersChange(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label={ariaLabel}>
      <UiPanelToolbar aria-label={`${ariaLabel} filters`} className="gap-1.5 overflow-visible">
        <div className="relative min-w-32 flex-1">
          <SearchIcon />
          <UiToolbarInput
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={queryPlaceholder}
            aria-label={`Search ${ariaLabel.toLowerCase()}`}
            className="w-full pl-7"
          />
        </div>
        {toolbarTrailing}
      </UiPanelToolbar>

      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <SelectionCheckbox
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected}
          disabled={selectableNumbers.length === 0}
          label={allVisibleSelected ? 'Clear visible selection' : 'Select all visible requests'}
          onChange={toggleAll}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {selectedNumbers.size > 0 ? (
            <span className="whitespace-nowrap text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
              {selectedNumbers.size} selected
            </span>
          ) : (
            filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => onFilterChange(filter.value)}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-medium)] px-2 text-[var(--text-10)] transition-colors',
                  activeFilter === filter.value
                    ? 'bg-[var(--surface-strong)] font-[var(--weight-semibold)] text-[var(--fg)]'
                    : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
                )}
                aria-pressed={activeFilter === filter.value}
              >
                <span className="leading-none">{filter.label}</span>
                <span className="leading-none tabular-nums text-[var(--muted-dim)]">
                  {filter.count}
                </span>
              </button>
            ))
          )}
        </div>
        {selectedNumbers.size > 0 ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <BulkActionButton action={mergeAction} />
            <BulkActionButton action={closeAction} />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {items.map((item) => (
          <div
            key={item.number}
            className={cn(
              'flex min-h-[4.25rem] items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5',
              selectedNumbers.has(item.number) && 'bg-[var(--accent-subtle)]',
            )}
          >
            <SelectionCheckbox
              checked={selectedNumbers.has(item.number)}
              disabled={item.selectionDisabled}
              label={`Select request #${item.number}`}
              className="mt-1"
              onChange={(checked) => toggleOne(item.number, checked)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <button
                  type="button"
                  onClick={() => onOpenRequest(item.number)}
                  className="min-w-0 flex-1 truncate text-left text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)] hover:text-[var(--accent)] hover:underline"
                  title={`Open #${item.number}: ${item.title}`}
                >
                  {item.title}
                </button>
                {item.signals ? (
                  <div className="flex shrink-0 items-center gap-1">{item.signals}</div>
                ) : null}
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--text-10)] text-[var(--muted)]">
                <span
                  className="font-mono tabular-nums text-[var(--muted-dim)]"
                  title={`Request #${item.number}`}
                >
                  #{item.number}
                </span>
                <span aria-hidden="true">·</span>
                <span className={requestStateTextClass(item.state)}>
                  {item.stateLabel ?? requestStateLabel(item.state)}
                </span>
                <span aria-hidden="true">·</span>
                {item.metadata}
                {item.lineStats ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <RequestLineStats stats={item.lineStats} />
                  </>
                ) : null}
              </div>
            </div>
            {item.externalHref || item.updatedAt ? (
              <div className="flex min-h-[2.75rem] shrink-0 self-stretch flex-col items-end justify-between">
                {item.externalHref ? (
                  <a
                    href={item.externalHref}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted-dim)] opacity-60 transition-[background-color,color,opacity] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)] hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Open request #${item.number} externally`}
                    title="Open externally"
                  >
                    <ExternalLinkIcon />
                  </a>
                ) : (
                  <span />
                )}
                {item.updatedAt ? (
                  <time
                    dateTime={item.updatedAt}
                    title={exactRequestTime(item.updatedAt)}
                    className="whitespace-nowrap font-mono text-[var(--text-9)] tabular-nums text-[var(--muted-dim)]"
                  >
                    {relativeRequestTime(item.updatedAt)}
                  </time>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
              {emptyTitle}
            </div>
            <div className="mt-1 text-[var(--text-10)] text-[var(--muted)]">
              {emptyDescription}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BulkActionButton({
  action,
}: {
  action: UnifiedRequestBulkAction;
}) {
  const unavailable = action.disabled || !action.onClick;
  return (
    <UiButton
      size="small"
      variant={action.tone === 'danger' ? 'danger' : 'secondary'}
      className={
        action.tone === 'success'
          ? 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] hover:border-[var(--green)] hover:bg-[color-mix(in_srgb,var(--green-subtle)_78%,var(--green)_22%)]'
          : undefined
      }
      leadingIcon={action.tone === 'success' ? <MergeIcon /> : <CloseIcon />}
      loading={action.loading}
      disabled={unavailable}
      onClick={action.onClick}
      title={action.title}
    >
      {action.label}
    </UiButton>
  );
}

function MergeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 4.5v7M7 3h1a4 4 0 0 1 4 4v4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="m6 6 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RequestLineStats({
  stats,
}: {
  stats: NonNullable<UnifiedRequestListItem['lineStats']>;
}) {
  const additions = Math.max(0, Math.floor(Number(stats.additions) || 0));
  const files = Math.max(0, Math.floor(Number(stats.files) || 0));
  const modifications = Math.max(0, Math.floor(Number(stats.modifications) || 0));
  const deletions = Math.max(0, Math.floor(Number(stats.deletions) || 0));
  const netLabel = agentRunNetLineChangeLabel(additions - deletions);
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono tabular-nums"
      aria-label={`${files} files changed, ${additions} additions, ${modifications} modifications, ${deletions} deletions, ${netLabel} net lines`}
    >
      <span className="text-[var(--muted-dim)]" title="Files changed">{files} files</span>
      <span className="text-[var(--green)]" title="Lines added">+{additions}</span>
      <span className="text-[var(--yellow)]" title="Estimated lines modified">~{modifications}</span>
      <span className="text-[var(--red)]" title="Lines deleted">−{deletions}</span>
      <span className="text-[var(--accent)]" title="Net line change">{netLabel}</span>
    </span>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled,
  label,
  className,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  className?: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
      className={cn(
        'h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-[var(--border)] accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    />
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-dim)]"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10 10 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M6 4H3.5A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h7a1.5 1.5 0 0 0 1.5-1.5V10M9 2h5v5M14 2 7.5 8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function requestStateLabel(state: UnifiedRequestState): string {
  if (state === 'merged') return 'Merged';
  if (state === 'closed') return 'Closed';
  if (state === 'draft') return 'Draft';
  return 'Open';
}

function requestStateTextClass(state: UnifiedRequestState): string {
  if (state === 'merged') return 'text-[var(--accent)]';
  if (state === 'closed') return 'text-[var(--red)]';
  if (state === 'draft') return 'text-[var(--muted)]';
  return 'text-[var(--green)]';
}

function relativeRequestTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function exactRequestTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return value;
  }
}
