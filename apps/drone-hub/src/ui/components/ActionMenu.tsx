import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import {
  UiToolbarButton,
  UiToolbarIconButton,
  type UiToolbarControlSize,
} from './Toolbar';

export type UiActionMenuItemTone = 'neutral' | 'danger';

export type UiActionMenuItem = {
  kind?: 'item';
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  disabled?: boolean;
  tone?: UiActionMenuItemTone;
  checked?: boolean;
  selectionRole?: 'checkbox' | 'radio';
};

export type UiActionMenuSeparator = {
  kind: 'separator';
  id: string;
};

export type UiActionMenuLabel = {
  kind: 'label';
  id: string;
  label: React.ReactNode;
};

export type UiActionMenuEntry =
  | UiActionMenuItem
  | UiActionMenuSeparator
  | UiActionMenuLabel;

export type UiActionMenuProps = {
  label: string;
  icon?: React.ReactNode;
  triggerContent?: React.ReactNode;
  entries: ReadonlyArray<UiActionMenuEntry>;
  onSelect: (id: string) => void;
  align?: 'start' | 'end';
  size?: UiToolbarControlSize;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  panelClassName?: string;
};

function selectableEntries(entries: ReadonlyArray<UiActionMenuEntry>) {
  return entries.filter(
    (entry): entry is UiActionMenuItem =>
      entry.kind !== 'separator' && entry.kind !== 'label' && !entry.disabled,
  );
}

function Checkmark() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
      <path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const focusableSelector =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function UiActionMenu({
  label,
  icon,
  triggerContent,
  entries,
  onSelect,
  align = 'end',
  size = 'small',
  disabled = false,
  open: openProp,
  onOpenChange,
  className,
  panelClassName,
}: UiActionMenuProps) {
  const controlled = typeof openProp === 'boolean';
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlled ? Boolean(openProp) : internalOpen;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const menuId = React.useId();
  const [panelPosition, setPanelPosition] = React.useState<{ left: number; top: number } | null>(
    null,
  );

  const setOpen = React.useCallback(
    (next: React.SetStateAction<boolean>) => {
      const resolved = typeof next === 'function' ? next(open) : next;
      if (!controlled) setInternalOpen(resolved);
      onOpenChange?.(resolved);
    },
    [controlled, onOpenChange, open],
  );

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  React.useEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return;
    }
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;
      const gap = 6;
      const viewportPadding = 6;
      const roomBelow = window.innerHeight - triggerRect.bottom;
      const top =
        roomBelow >= panelHeight + gap
          ? triggerRect.bottom + gap
          : Math.max(viewportPadding, triggerRect.top - panelHeight - gap);
      const naturalLeft =
        align === 'end' ? triggerRect.right - panelWidth : triggerRect.left;
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - panelWidth - viewportPadding,
      );
      const left = Math.min(maxLeft, Math.max(viewportPadding, naturalLeft));
      setPanelPosition({ left, top });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, open]);

  const focusEntry = React.useCallback(
    (position: 'first' | 'last') => {
      const available = selectableEntries(entries);
      const entry = position === 'first' ? available[0] : available[available.length - 1];
      if (!entry) return;
      window.requestAnimationFrame(() => itemRefs.current.get(entry.id)?.focus());
    },
    [entries],
  );

  React.useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open, setOpen]);

  const moveFocus = (currentId: string, direction: 1 | -1) => {
    const available = selectableEntries(entries);
    if (available.length === 0) return;
    const currentIndex = Math.max(0, available.findIndex((entry) => entry.id === currentId));
    const nextIndex = (currentIndex + direction + available.length) % available.length;
    itemRefs.current.get(available[nextIndex].id)?.focus();
  };

  const leaveMenu = (backwards: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) => !panelRef.current?.contains(element),
    );
    const triggerIndex = focusable.indexOf(trigger);
    const nextIndex = triggerIndex + (backwards ? -1 : 1);
    const target = focusable[nextIndex] ?? trigger;
    setOpen(false);
    window.requestAnimationFrame(() => target.focus());
  };

  const menu = open ? (
    <div
      ref={panelRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className={cn(
        'z-[200] max-h-[calc(100vh-0.75rem)] min-w-52 max-w-[calc(100vw-0.75rem)] overflow-y-auto rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-raised)] py-1 shadow-[0_16px_48px_var(--shadow-color)]',
        typeof document === 'undefined' ? 'absolute top-full mt-1.5' : 'fixed',
        typeof document === 'undefined' && (align === 'end' ? 'right-0' : 'left-0'),
        panelClassName,
      )}
      style={
        typeof document === 'undefined'
          ? undefined
          : {
              left: panelPosition?.left ?? 0,
              top: panelPosition?.top ?? 0,
              visibility: panelPosition ? 'visible' : 'hidden',
            }
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          leaveMenu(event.shiftKey);
        }
      }}
    >
      {entries.map((entry) => {
        if (entry.kind === 'separator') {
          return (
            <div
              key={entry.id}
              role="separator"
              className="my-1 border-t border-[var(--border-subtle)]"
            />
          );
        }
        if (entry.kind === 'label') {
          return (
            <div
              key={entry.id}
              role="presentation"
              className="px-3 py-1 text-[length:var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.1em] text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              {entry.label}
            </div>
          );
        }
        const role =
          entry.selectionRole === 'checkbox'
            ? 'menuitemcheckbox'
            : entry.selectionRole === 'radio'
              ? 'menuitemradio'
              : 'menuitem';
        return (
          <button
            key={entry.id}
            ref={(element) => {
              if (element) itemRefs.current.set(entry.id, element);
              else itemRefs.current.delete(entry.id);
            }}
            type="button"
            role={role}
            tabIndex={-1}
            aria-checked={entry.selectionRole ? Boolean(entry.checked) : undefined}
            disabled={entry.disabled}
            onClick={() => {
              onSelect(entry.id);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveFocus(entry.id, 1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveFocus(entry.id, -1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                focusEntry('first');
              } else if (event.key === 'End') {
                event.preventDefault();
                focusEntry('last');
              }
            }}
            className={cn(
              'flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-[length:var(--text-10)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
              entry.tone === 'danger'
                ? 'text-[var(--red)] hover:bg-[var(--red-subtle)]'
                : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]',
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
              {entry.selectionRole ? (entry.checked ? <Checkmark /> : null) : entry.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.meta ? (
              <span className="shrink-0 text-[length:var(--text-8)] text-[var(--muted-dim)]">
                {entry.meta}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      {triggerContent ? (
        <UiToolbarButton
          ref={triggerRef}
          aria-label={label}
          size={size}
          pressed={open}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen) focusEntry('first');
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            if (!open) setOpen(true);
            focusEntry(event.key === 'ArrowDown' ? 'first' : 'last');
          }}
        >
          {triggerContent}
        </UiToolbarButton>
      ) : (
        <UiToolbarIconButton
          ref={triggerRef}
          label={label}
          icon={icon}
          size={size}
          pressed={open}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen) focusEntry('first');
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            if (!open) setOpen(true);
            focusEntry(event.key === 'ArrowDown' ? 'first' : 'last');
          }}
        />
      )}
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
}
