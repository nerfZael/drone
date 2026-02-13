import * as React from 'react';
import { cn } from './cn';
import { dropdownMenuItemBaseClass, dropdownPanelBaseClass, useDropdownDismiss } from './dropdown';

type UiMenuSelectVariant = 'form' | 'toolbar';

type UiMenuSelectOptionEntry = {
  kind?: 'option';
  value: string;
  label: React.ReactNode;
  title?: string;
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
  triggerLabel?: React.ReactNode;
  triggerLabelClassName?: string;
  chevron?: (open: boolean) => React.ReactNode;
  role?: 'menu' | 'listbox';
  itemRole?: 'menuitem' | 'option';
};

const triggerBaseClassNameByVariant: Record<UiMenuSelectVariant, string> = {
  form: 'w-full h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] focus:outline-none transition-colors flex items-center justify-between gap-2',
  toolbar:
    'inline-flex items-center gap-1.5 h-[28px] pl-2 pr-1.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] font-semibold text-[var(--muted)] focus:outline-none transition-all',
};

const panelPositionClassNameByVariant: Record<UiMenuSelectVariant, string> = {
  form: 'absolute left-0 right-0 mt-1.5 z-30',
  toolbar: 'absolute left-0 mt-2 z-50',
};

function isOptionEntry(entry: UiMenuSelectEntry): entry is UiMenuSelectOptionEntry {
  return entry.kind !== 'separator';
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
    triggerLabel,
    triggerLabelClassName,
    chevron,
    role = 'menu',
    itemRole = 'menuitem',
  } = props;

  const isControlled = typeof openProp === 'boolean';
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? Boolean(openProp) : internalOpen;

  const setOpen = React.useCallback(
    (next: React.SetStateAction<boolean>) => {
      const resolved = typeof next === 'function' ? next(open) : next;
      if (!isControlled) setInternalOpen(resolved);
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
                'px-3 py-2 text-[9px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase border-b border-[var(--border-subtle)]',
                headerClassName
              )}
              style={headerStyle}
            >
              {header}
            </div>
          ) : null}
          <div className={cn('py-1', menuClassName)}>
            {entries.map((entry, index) => {
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
          </div>
        </div>
      )}
    </div>
  );
}
