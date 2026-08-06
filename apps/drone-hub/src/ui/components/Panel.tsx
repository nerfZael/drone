import * as React from 'react';
import { cn } from '../cn';

export type UiPanelSurface = 'default' | 'alternate' | 'raised' | 'inset';

const surfaceClassName: Record<UiPanelSurface, string> = {
  default: 'bg-[var(--panel)]',
  alternate: 'bg-[var(--panel-alt)]',
  raised: 'bg-[var(--panel-raised)] shadow-[var(--edge-highlight),var(--shadow-raised)]',
  inset: 'bg-[var(--surface-inset)]',
};

export type UiPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  surface?: UiPanelSurface;
  flush?: boolean;
};

export const UiPanel = React.forwardRef<HTMLDivElement, UiPanelProps>(function UiPanel(
  { surface = 'default', flush = false, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'ui-panel flex min-h-0 min-w-0 flex-col overflow-hidden',
        !flush && 'rounded-[var(--radius-large)] border border-[var(--border-subtle)]',
        surfaceClassName[surface],
        className,
      )}
      {...props}
    />
  );
});

export type UiPanelHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  density?: 'compact' | 'default';
};

export function UiPanelHeader({
  title,
  eyebrow,
  description,
  leading,
  meta,
  actions,
  density = 'default',
  className,
  ...props
}: UiPanelHeaderProps) {
  return (
    <div
      className={cn(
        'ui-panel-header flex shrink-0 items-start gap-2 border-b border-[var(--border-subtle)] bg-transparent',
        density === 'compact' ? 'min-h-8 px-2.5 py-1.5' : 'min-h-11 px-3 py-2.5',
        className,
      )}
      {...props}
    >
      {leading ? <div className="shrink-0 text-[var(--muted)]">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="truncate dh-type-eyebrow">
                {eyebrow}
              </div>
            ) : null}
            <div
              className={cn(
                'truncate text-[var(--fg-strong)]',
                density === 'compact' ? 'dh-type-control-compact' : 'dh-type-heading',
              )}
            >
              {title}
            </div>
          </div>
          {meta ? <div className="shrink-0">{meta}</div> : null}
        </div>
        {description ? (
          <div className="mt-0.5 truncate dh-type-supporting !text-[var(--muted)]">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function UiPanelToolbar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role={props.role ?? 'toolbar'}
      className={cn(
        'ui-panel-toolbar flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--border-subtle)] bg-transparent px-2.5 py-1.5',
        className,
      )}
      {...props}
    />
  );
}

export const UiPanelBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { scroll?: boolean }
>(function UiPanelBody({ scroll = false, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'ui-panel-body min-h-0 min-w-0 flex-1',
        scroll ? 'overflow-auto' : 'overflow-hidden',
        className,
      )}
      {...props}
    />
  );
});

export type UiPanelStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const statusToneClassName: Record<UiPanelStatusTone, string> = {
  neutral: 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]',
  info: 'border-[var(--info-border)] bg-[var(--info-subtle)] text-[var(--info)]',
  success: 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]',
  warning: 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
  danger: 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]',
};

export type UiPanelStatusStripProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: UiPanelStatusTone;
  action?: React.ReactNode;
  dot?: boolean;
};

export function UiPanelStatusStrip({
  tone = 'neutral',
  action,
  dot = false,
  className,
  children,
  ...props
}: UiPanelStatusStripProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex min-h-7 shrink-0 items-center gap-2 border-b px-2.5 py-1 text-[length:var(--text-9)]',
        statusToneClassName[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" /> : null}
      <div className="min-w-0 flex-1 truncate">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
