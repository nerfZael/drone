import * as React from 'react';
import { cn } from '../cn';
import { useSlidingIndicator } from '../use-sliding-indicator';
import { UiBadge, type UiBadgeTone } from './Badge';

export type UiTabOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  badgeTone?: UiBadgeTone;
  disabled?: boolean;
  tabId?: string;
  panelId?: string;
};

export type UiTabsProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<UiTabOption<T>>;
  onValueChange: (value: T) => void;
  size?: 'small' | 'medium';
  className?: string;
};

export function UiTabs<T extends string>({
  label,
  value,
  options,
  onValueChange,
  size = 'medium',
  className,
}: UiTabsProps<T>) {
  const tabRefs = React.useRef(new Map<T, HTMLButtonElement>());
  const { containerRef, indicator } = useSlidingIndicator(value, tabRefs);
  const moveSelection = (currentValue: T, key: string) => {
    const enabledOptions = options.filter((option) => !option.disabled);
    if (enabledOptions.length === 0) return;
    const currentIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === currentValue));
    let nextIndex = currentIndex;
    if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % enabledOptions.length;
    else if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
    else if (key === 'Home') nextIndex = 0;
    else if (key === 'End') nextIndex = enabledOptions.length - 1;
    else return;
    const nextValue = enabledOptions[nextIndex].value;
    onValueChange(nextValue);
    window.requestAnimationFrame(() => tabRefs.current.get(nextValue)?.focus());
  };

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={label}
      className={cn('relative flex min-w-0 items-end gap-1 border-b border-[var(--border-subtle)]', className)}
    >
      {indicator ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-px h-[2px] rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent-border)] transition-[left,width] duration-200 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none"
          style={{ left: indicator.left, width: indicator.width }}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={option.tabId}
            aria-selected={selected}
            aria-controls={option.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              moveSelection(option.value, event.key);
            }}
            ref={(element) => {
              if (element) tabRefs.current.set(option.value, element);
              else tabRefs.current.delete(option.value);
            }}
            className={cn(
              'relative inline-flex min-w-0 items-center justify-center gap-1.5 rounded-t-[var(--radius-medium)] transition-[background-color,color,box-shadow] duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
              size === 'small' ? 'h-7 px-2 dh-type-control-compact' : 'h-9 px-3 dh-type-control',
              selected
                ? 'text-[var(--accent)]'
                : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-softest)] hover:text-[var(--fg)]',
            )}
          >
            {option.icon ? <span className="shrink-0" aria-hidden="true">{option.icon}</span> : null}
            <span className="truncate">{option.label}</span>
            {option.badge != null ? <UiBadge tone={option.badgeTone ?? 'neutral'} className="h-4 px-1.5 !text-[length:var(--text-10)]">{option.badge}</UiBadge> : null}
          </button>
        );
      })}
    </div>
  );
}

export type UiDisclosureProps = Omit<React.DetailsHTMLAttributes<HTMLDetailsElement>, 'onToggle' | 'title'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function UiDisclosure({
  title,
  description,
  badge,
  open,
  defaultOpen,
  onOpenChange,
  className,
  children,
  ...props
}: UiDisclosureProps) {
  const controlled = typeof open === 'boolean';
  const [internalOpen, setInternalOpen] = React.useState(Boolean(defaultOpen));
  const resolvedOpen = controlled ? open : internalOpen;
  return (
    <details
      open={resolvedOpen}
      onToggle={(event) => {
        if (!controlled) setInternalOpen(event.currentTarget.open);
        onOpenChange?.(event.currentTarget.open);
      }}
      className={cn(
        'group/disclosure border-b border-[var(--border-subtle)]',
        className,
      )}
      {...props}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-[var(--radius-medium)] px-1 py-2.5 text-left marker:hidden hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--muted-dim)] transition-transform group-open/disclosure:rotate-90" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
            <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block dh-type-control text-[var(--fg-secondary)]">{title}</span>
          {description ? <span className="mt-0.5 block dh-type-supporting">{description}</span> : null}
        </span>
        {badge ? <span className="shrink-0">{badge}</span> : null}
      </summary>
      <div className="px-1 pb-3 pt-1 dh-type-control-compact text-[var(--muted)]">
        {children}
      </div>
    </details>
  );
}
