import * as React from 'react';
import { cn } from './cn.js';
import { useDropdownDismiss } from './dropdown.js';

type UiMenuSelectVariant = 'form' | 'toolbar';

type UiMenuSelectOptionEntry = {
  kind?: 'option';
  value: string;
  label: React.ReactNode;
  title?: string;
  searchText?: string;
  disabled?: boolean;
  className?: string;
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
  placement?: 'above' | 'below';
  disabled?: boolean;
  title?: string;
  triggerClassName?: string;
  panelClassName?: string;
  menuClassName?: string;
  header?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptySearchLabel?: React.ReactNode;
  triggerLabel?: React.ReactNode;
  role?: 'menu' | 'listbox';
  itemRole?: 'menuitem' | 'option';
};

function isOptionEntry(entry: UiMenuSelectEntry): entry is UiMenuSelectOptionEntry {
  return entry.kind !== 'separator';
}

function DefaultChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={cn('h-3 w-3 shrink-0 fill-current opacity-70 transition-transform duration-150', open && 'rotate-180')}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
    </svg>
  );
}

export function UiMenuSelect({
  value,
  onValueChange,
  entries,
  variant = 'form',
  placement = 'above',
  disabled = false,
  title,
  triggerClassName,
  panelClassName,
  menuClassName,
  header,
  searchable = false,
  searchPlaceholder = 'Search...',
  emptySearchLabel = 'No matches',
  triggerLabel,
  role = 'menu',
  itemRole = 'menuitem',
}: UiMenuSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(menuRef, open, setOpen);

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectedEntry = React.useMemo(
    () => entries.find((entry) => isOptionEntry(entry) && entry.value === value) as UiMenuSelectOptionEntry | undefined,
    [entries, value],
  );
  const filteredEntries = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!searchable || !query) return entries;
    return entries.filter((entry) => {
      if (!isOptionEntry(entry)) return true;
      const haystack = [entry.searchText, entry.title, entry.value]
        .map((part) => String(part ?? '').trim().toLowerCase())
        .filter(Boolean);
      return haystack.some((part) => part.includes(query));
    });
  }, [entries, searchQuery, searchable]);
  const hasOptions = filteredEntries.some((entry) => isOptionEntry(entry));

  return (
    <div
      ref={menuRef}
      className={cn('relative min-w-0', variant === 'toolbar' && 'shrink-0 basis-[132px] max-[620px]:basis-auto', open && 'is-open')}
    >
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        disabled={disabled}
        title={title}
        aria-haspopup={role}
        aria-expanded={open}
        className={cn(
          'flex h-7 w-full items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-left font-display text-[10px] font-bold uppercase tracking-normal text-[var(--muted)] transition-colors hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-50',
          open && '!border-[rgba(74,222,128,.26)] !bg-[rgba(74,222,128,.08)] !text-[var(--green)]',
          triggerClassName,
        )}
      >
        <span className="min-w-0 truncate">{triggerLabel ?? selectedEntry?.label ?? ''}</span>
        <DefaultChevron open={open} />
      </button>

      {open ? (
        <div
          className={cn(
            'absolute left-0 z-[42] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)] shadow-[0_14px_42px_rgba(0,0,0,.34)]',
            placement === 'above' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
            panelClassName,
          )}
          role={role}
        >
          {header ? (
            <div className="border-b border-[var(--border-subtle)] px-2.5 py-2 font-display text-[10px] font-bold uppercase text-[var(--muted-dim)]">
              {header}
            </div>
          ) : null}
          {searchable ? (
            <div className="border-b border-[var(--border-subtle)] p-1.5">
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder={searchPlaceholder}
                className="h-7 w-full rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] px-2 text-[11px] text-[var(--fg)] outline-none"
              />
            </div>
          ) : null}
          <div className={cn('grid max-h-[260px] gap-0.5 overflow-auto p-1.5', menuClassName)}>
            {filteredEntries.map((entry, index) => {
              if (!isOptionEntry(entry)) {
                return <div key={entry.key ?? `separator-${index}`} className={cn('my-1 border-t border-[var(--border-subtle)]', entry.className)} />;
              }
              const active = entry.value === value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  role={itemRole}
                  aria-selected={itemRole === 'option' ? active : undefined}
                  disabled={entry.disabled}
                  title={entry.title}
                  className={cn(
                    'flex min-h-[30px] w-full items-center justify-between gap-2.5 rounded border-0 bg-transparent px-2 py-1.5 text-left text-[var(--fg-secondary)] transition-colors hover:bg-[rgba(255,255,255,.055)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40',
                    active && '!bg-[rgba(255,255,255,.055)] !text-[var(--fg)]',
                    entry.className,
                  )}
                  onClick={() => {
                    if (entry.disabled) return;
                    setOpen(false);
                    setSearchQuery('');
                    onValueChange(entry.value);
                  }}
                >
                  {entry.label}
                </button>
              );
            })}
            {!hasOptions ? <div className="px-2.5 py-3 text-[10px] font-bold uppercase text-[var(--muted-dim)]">{emptySearchLabel}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
