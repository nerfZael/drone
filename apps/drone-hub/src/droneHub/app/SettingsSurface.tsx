import * as React from 'react';

import { cn } from '../../ui/cn';

export type SettingsSectionProps = React.HTMLAttributes<HTMLElement> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
};

/**
 * Settings are grouped by rhythm and a single separator, not nested containers.
 * Keep backgrounds and enclosing borders for controls, menus, and dialogs.
 */
export function SettingsSection({
  title,
  description,
  actions,
  compact = false,
  className,
  children,
  ...props
}: SettingsSectionProps) {
  return (
    <section
      className={cn(
        'dh-settings-section',
        compact && 'dh-settings-section--compact',
        className,
      )}
      {...props}
    >
      {title || description || actions ? (
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? <h2 className="dh-type-heading text-[var(--fg-strong)]">{title}</h2> : null}
            {description ? (
              <p className="mt-1 max-w-[68ch] dh-type-supporting !text-[var(--muted)]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsSplitView({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-1 overflow-hidden xl:grid-cols-[240px_minmax(0,1fr)]',
        className,
      )}
      {...props}
    />
  );
}

export function SettingsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'min-w-0 border-b border-[var(--border-subtle)] pb-3 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-3',
        className,
      )}
      {...props}
    />
  );
}

export type SettingsListRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  title: React.ReactNode;
  meta?: React.ReactNode;
  detail?: React.ReactNode;
};

export const SettingsListRow = React.forwardRef<HTMLButtonElement, SettingsListRowProps>(
  function SettingsListRow(
    { selected = false, title, meta, detail, className, type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'relative flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[var(--radius-medium)] px-2.5 py-1.5 text-left dh-type-control transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]',
          selected
            ? 'bg-[var(--selected)] text-[var(--fg)] before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--accent)]'
            : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {detail ? (
            <span className="mt-0.5 block truncate dh-type-supporting">
              {detail}
            </span>
          ) : null}
        </span>
        {meta ? <span className="shrink-0 dh-type-menu-meta">{meta}</span> : null}
      </button>
    );
  },
);

export function SettingsEmptyState({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2 py-6 text-center dh-type-supporting !text-[var(--muted-dim)]', className)}
      {...props}
    />
  );
}

export function SettingsDetail({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 pt-4 xl:pl-4 xl:pt-0', className)} {...props} />;
}
