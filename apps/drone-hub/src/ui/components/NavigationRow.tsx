import * as React from 'react';
import { cn } from '../cn';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      className={cn('h-3 w-3 transition-transform', open ? 'rotate-90' : '')}
      aria-hidden="true"
    >
      <path d="m4 2.5 3.5 3.5L4 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type UiNavigationRowProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  label: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  status?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  depth?: number;
  selected?: boolean;
  current?: boolean;
  highlighted?: boolean;
  expandable?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  density?: 'compact' | 'default';
};

export const UiNavigationRow = React.forwardRef<HTMLButtonElement, UiNavigationRowProps>(
  function UiNavigationRow(
    {
      label,
      description,
      leading,
      status,
      meta,
      actions,
      depth = 0,
      selected = false,
      current = false,
      highlighted = false,
      expandable = false,
      open = false,
      onOpenChange,
      density = 'default',
      disabled,
      className,
      onClick,
      style,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const rowHeightClassName = density === 'compact' ? 'min-h-7' : 'min-h-9';
    return (
      <div
        className={cn(
          'group/navigation-row relative flex min-w-0 items-center rounded-[var(--sidebar-row-radius)]',
          rowHeightClassName,
          selected
            ? 'bg-[var(--selected)] text-[var(--fg)]'
            : highlighted
              ? 'bg-[var(--accent-subtle)] text-[var(--fg)]'
              : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
          disabled && 'opacity-40',
          className,
        )}
      >
        {selected ? (
          <span
            className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent-border)]"
            aria-hidden="true"
          />
        ) : null}
        <button
          ref={ref}
          type={type}
          disabled={disabled}
          aria-current={props['aria-current'] ?? (current ? 'page' : undefined)}
          aria-selected={
            props['aria-selected'] ?? (props.role === 'treeitem' ? selected : undefined)
          }
          aria-expanded={expandable ? open : undefined}
          onClick={(event) => {
            if (expandable && onOpenChange) onOpenChange(!open);
            onClick?.(event);
          }}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded-[var(--sidebar-row-radius)] pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed',
            density === 'compact' ? 'dh-type-control-compact' : 'dh-type-control',
          )}
          style={{ paddingLeft: `${8 + Math.max(0, depth) * 14}px`, ...style }}
          {...props}
        >
          {expandable ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--muted-dim)]">
              <Chevron open={open} />
            </span>
          ) : depth > 0 ? (
            <span className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : null}
          {leading ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
              {leading}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{label}</span>
              {status ? <span className="shrink-0">{status}</span> : null}
            </span>
            {description ? (
              <span className="block truncate dh-type-supporting !text-[var(--text-11)]">
                {description}
              </span>
            ) : null}
          </span>
          {meta ? <span className="shrink-0 dh-type-menu-meta">{meta}</span> : null}
        </button>
        {actions && !disabled ? (
          <div className="mr-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/navigation-row:opacity-100 group-focus-within/navigation-row:opacity-100">
            {actions}
          </div>
        ) : null}
      </div>
    );
  },
);
