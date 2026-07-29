import * as React from 'react';
import { cn } from '../cn';

export type UiPanelSurface = 'default' | 'alternate' | 'raised' | 'inset';

const surfaceClassName: Record<UiPanelSurface, string> = {
  default: 'bg-[var(--panel)]',
  alternate: 'bg-[var(--panel-alt)]',
  raised: 'bg-[var(--panel-raised)] shadow-[0_10px_28px_var(--shadow-color)]',
  inset: 'bg-[var(--surface-inset)]',
};

export type UiPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  surface?: UiPanelSurface;
};

export const UiPanel = React.forwardRef<HTMLDivElement, UiPanelProps>(function UiPanel(
  { surface = 'default', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)]',
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
        'flex shrink-0 items-start gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)]',
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
              <div
                className="truncate text-[length:var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted-dim)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                {eyebrow}
              </div>
            ) : null}
            <div
              className={cn(
                'truncate font-[var(--weight-semibold)] text-[var(--fg-strong)]',
                density === 'compact' ? 'text-[length:var(--text-10)] uppercase tracking-[0.1em]' : 'text-[length:var(--text-13)]',
              )}
              style={{ fontFamily: 'var(--display)' }}
            >
              {title}
            </div>
          </div>
          {meta ? <div className="shrink-0">{meta}</div> : null}
        </div>
        {description ? (
          <div className="mt-0.5 truncate text-[length:var(--text-10)] text-[var(--muted)]">
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
        'flex min-h-8 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--panel-alt)] px-2 py-1',
        className,
      )}
      {...props}
    />
  );
}

export function UiPanelBody({
  scroll = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { scroll?: boolean }) {
  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex-1',
        scroll ? 'overflow-auto' : 'overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

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
