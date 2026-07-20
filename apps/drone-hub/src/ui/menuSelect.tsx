import * as React from 'react';
import { cn } from './cn';
import { dropdownMenuItemBaseClass, dropdownPanelBaseClass, useDropdownDismiss } from './dropdown';

type UiMenuSelectVariant = 'form' | 'toolbar';

type UiMenuSelectOptionEntry = {
  kind?: 'option';
  value: string;
  label: React.ReactNode;
  title?: string;
  searchText?: string;
  disabled?: boolean;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
};

type UiMenuSelectSeparatorEntry = {
  kind: 'separator';
  key?: string;
  className?: string;
};

export type UiMenuSelectEntry = UiMenuSelectOptionEntry | UiMenuSelectSeparatorEntry;

type UiMenuSelectProps = {
  value: string;
  onValueChange: (next: string) => void;
  entries: UiMenuSelectEntry[];
  variant?: UiMenuSelectVariant;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  triggerClassName?: string;
  panelClassName?: string;
  menuClassName?: string;
  header?: React.ReactNode;
  headerClassName?: string;
  headerStyle?: React.CSSProperties;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptySearchLabel?: React.ReactNode;
  triggerLabel?: React.ReactNode;
  triggerLabelClassName?: string;
  chevron?: (open: boolean) => React.ReactNode;
  role?: 'menu' | 'listbox';
  itemRole?: 'menuitem' | 'option';
};

const triggerBaseClassNameByVariant: Record<UiMenuSelectVariant, string> = {
  form: 'w-full h-[var(--control-height)] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-13)] focus:outline-none transition-colors flex items-center justify-between gap-2',
  toolbar:
    'inline-flex items-center gap-1.5 h-[28px] pl-2 pr-1.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--muted)] focus:outline-none transition-all',
};

const panelPositionClassNameByVariant: Record<UiMenuSelectVariant, string> = {
  form: 'absolute left-0 right-0 mt-1.5 z-30',
  toolbar: 'absolute left-0 mt-2 z-50',
};

function isOptionEntry(entry: UiMenuSelectEntry): entry is UiMenuSelectOptionEntry {
  return entry.kind !== 'separator';
}

function nodeSearchText(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function fuzzyMatchScore(rawCandidate: string, rawQuery: string): number | null {
  const candidate = rawCandidate.trim().toLowerCase().replace(/[\s._:/-]+/g, ' ');
  const query = rawQuery.trim().toLowerCase().replace(/[\s._:/-]+/g, ' ');
  if (!candidate || !query) return null;

  const exactIndex = candidate.indexOf(query);
  if (exactIndex >= 0) {
    return 1000 - exactIndex * 4 - Math.max(0, candidate.length - query.length);
  }

  const compactCandidate = candidate.replace(/\s+/g, '');
  const compactQuery = query.replace(/\s+/g, '');
  const compactIndex = compactCandidate.indexOf(compactQuery);
  if (compactIndex >= 0) {
    return 900 - compactIndex * 4 - Math.max(0, compactCandidate.length - compactQuery.length);
  }

  let score = 0;
  let queryIndex = 0;
  let previousMatchIndex = -1;
  for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < query.length; candidateIndex += 1) {
    if (candidate[candidateIndex] !== query[queryIndex]) continue;

    const previousChar = candidateIndex > 0 ? candidate[candidateIndex - 1] : '';
    const isBoundary = candidateIndex === 0 || /[\s._:/-]/.test(previousChar);
    const isContiguous = previousMatchIndex >= 0 && candidateIndex === previousMatchIndex + 1;
    score += 8;
    if (isBoundary) score += 7;
    if (isContiguous) score += 10;
    if (previousMatchIndex >= 0 && !isContiguous) score -= Math.min(6, candidateIndex - previousMatchIndex - 1);

    previousMatchIndex = candidateIndex;
    queryIndex += 1;
  }

  if (queryIndex !== query.length) return null;
  return score - Math.max(0, candidate.length - query.length) * 0.25;
}

function optionSearchScore(entry: UiMenuSelectOptionEntry, query: string): number | null {
  const candidates = [entry.searchText, entry.title, entry.value, nodeSearchText(entry.label)]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  let bestScore: number | null = null;
  for (const candidate of candidates) {
    const score = fuzzyMatchScore(candidate, query);
    if (score === null) continue;
    bestScore = bestScore === null ? score : Math.max(bestScore, score);
  }
  return bestScore;
}

function DefaultChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={cn('transition-transform duration-150 text-[var(--muted-dim)] opacity-60 flex-shrink-0', open ? '-rotate-90' : 'rotate-0')}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
    </svg>
  );
}

export function UiMenuSelect(props: UiMenuSelectProps) {
  const {
    value,
    onValueChange,
    entries,
    variant = 'form',
    open: openProp,
    onOpenChange,
    disabled = false,
    title,
    triggerClassName,
    panelClassName,
    menuClassName,
    header,
    headerClassName,
    headerStyle,
    searchable = false,
    searchPlaceholder = 'Search…',
    emptySearchLabel = 'No matches',
    triggerLabel,
    triggerLabelClassName,
    chevron,
    role = 'menu',
    itemRole = 'menuitem',
  } = props;

  const isControlled = typeof openProp === 'boolean';
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? Boolean(openProp) : internalOpen;
  const [searchQuery, setSearchQuery] = React.useState('');

  const setOpen = React.useCallback(
    (next: React.SetStateAction<boolean>) => {
      const resolved = typeof next === 'function' ? next(open) : next;
      if (!isControlled) setInternalOpen(resolved);
      if (!resolved) setSearchQuery('');
      onOpenChange?.(resolved);
    },
    [isControlled, onOpenChange, open]
  );

  React.useEffect(() => {
    if (!disabled || !open) return;
    setOpen(false);
  }, [disabled, open, setOpen]);

  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(menuRef, open, setOpen);

  const selectedEntry = React.useMemo(
    () => entries.find((entry) => isOptionEntry(entry) && entry.value === value) as UiMenuSelectOptionEntry | undefined,
    [entries, value]
  );
  const filteredEntries = React.useMemo(() => {
    const query = searchQuery.trim();
    if (!searchable || !query) return entries;
    return entries
      .map((entry, index) => {
        if (!isOptionEntry(entry)) return null;
        const score = optionSearchScore(entry, query);
        return score === null ? null : { entry, index, score };
      })
      .filter((item): item is { entry: UiMenuSelectOptionEntry; index: number; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.entry);
  }, [entries, searchQuery, searchable]);

  const resolvedTriggerLabel = triggerLabel ?? selectedEntry?.label ?? '';

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        disabled={disabled}
        title={title}
        aria-haspopup={role}
        aria-expanded={open}
        className={cn(
          triggerBaseClassNameByVariant[variant],
          variant === 'form'
            ? disabled
              ? 'opacity-40 cursor-not-allowed text-[var(--muted-dim)]'
              : 'text-[var(--fg)] hover:border-[var(--border)]'
            : disabled
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]',
          triggerClassName
        )}
      >
        <span className={cn('min-w-0 truncate', triggerLabelClassName)}>{resolvedTriggerLabel}</span>
        {chevron ? chevron(open) : <DefaultChevron open={open} />}
      </button>

      {open && (
        <div className={cn(panelPositionClassNameByVariant[variant], dropdownPanelBaseClass, panelClassName)} role={role}>
          {header ? (
            <div
              className={cn(
                'px-3 py-2 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-[0.12em] uppercase border-b border-[var(--border-subtle)]',
                headerClassName
              )}
              style={headerStyle}
            >
              {header}
            </div>
          ) : null}
          {searchable ? (
            <div className="px-2 pt-2 pb-1 border-b border-[var(--border-subtle)]">
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full h-[var(--control-height-compact)] rounded border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-2 text-[var(--text-11)] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
              />
            </div>
          ) : null}
          <div className={cn('py-1', menuClassName)}>
            {filteredEntries.map((entry, index) => {
              if (!isOptionEntry(entry)) {
                return <div key={entry.key ?? `separator-${index}`} className={cn('my-1 border-t border-[var(--border-subtle)]', entry.className)} />;
              }
              const active = entry.value === value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => {
                    if (entry.disabled) return;
                    setOpen(false);
                    onValueChange(entry.value);
                  }}
                  className={cn(
                    dropdownMenuItemBaseClass,
                    active ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]',
                    active ? entry.activeClassName : entry.inactiveClassName,
                    entry.disabled ? 'opacity-40 cursor-not-allowed' : null,
                    entry.className
                  )}
                  title={entry.title}
                  role={itemRole}
                  disabled={entry.disabled}
                >
                  {entry.label}
                </button>
              );
            })}
            {filteredEntries.every((entry) => !isOptionEntry(entry)) ? (
              <div className="px-3 py-3 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted-dim)]">
                {emptySearchLabel}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
