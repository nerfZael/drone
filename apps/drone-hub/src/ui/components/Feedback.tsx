import * as React from 'react';
import { cn } from '../cn';

export type UiSpinnerSize = 'small' | 'medium' | 'large';

const spinnerSizeClassName: Record<UiSpinnerSize, string> = {
  small: 'h-3.5 w-3.5 border',
  medium: 'h-5 w-5 border-2',
  large: 'h-7 w-7 border-2',
};

export function UiSpinner({
  size = 'medium',
  label = 'Loading',
  inheritColor = false,
  className,
}: {
  size?: UiSpinnerSize;
  label?: string | null;
  inheritColor?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-2', !inheritColor && 'text-[var(--muted)]', className)}
      style={inheritColor ? { color: 'inherit' } : undefined}
      role={label ? 'status' : undefined}
    >
      <span
        className={cn(
          'inline-block shrink-0 animate-spin rounded-full border-[color-mix(in_srgb,currentColor_28%,transparent)] border-t-current motion-reduce:animate-none',
          spinnerSizeClassName[size],
        )}
        aria-hidden="true"
      />
      {label ? <span className="text-[length:var(--text-11)]">{label}</span> : null}
    </span>
  );
}

export type UiAlertTone = 'info' | 'success' | 'warning' | 'danger';

const alertToneClassName: Record<UiAlertTone, string> = {
  info: 'border-[var(--info-border)] bg-[var(--info-subtle)] text-[var(--info)]',
  success: 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]',
  warning: 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
  danger: 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]',
};

function AlertIcon({ tone }: { tone: UiAlertTone }) {
  if (tone === 'success') {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="m5 8 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'warning' || tone === 'danger') {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
        <path d="M8 1.75 14.25 13H1.75L8 1.75Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        <path d="M8 5.25v3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="8" cy="11" r=".75" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.25v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.75" r=".75" fill="currentColor" />
    </svg>
  );
}

export type UiAlertProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: UiAlertTone;
  title?: React.ReactNode;
  action?: React.ReactNode;
};

export function UiAlert({ tone = 'info', title, action, className, children, ...props }: UiAlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-[var(--radius-large)] border px-3.5 py-3 shadow-[var(--edge-highlight)]', alertToneClassName[tone], className)}
      {...props}
    >
      <span className="mt-0.5 shrink-0">
        <AlertIcon tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        {title ? (
          <div className="text-[length:var(--text-11)] font-[var(--weight-semibold)] text-current" style={{ fontFamily: 'var(--display)' }}>
            {title}
          </div>
        ) : null}
        <div className={cn('text-[length:var(--text-11)] leading-relaxed text-[var(--fg-secondary)]', title && 'mt-0.5')}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function UiSkeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
        className={cn(
        'relative h-3 overflow-hidden rounded-[4px] bg-[var(--surface-strong)] before:absolute before:inset-0 before:animate-[shimmer-bar_1.5s_ease-in-out_infinite] before:bg-gradient-to-r before:from-transparent before:via-[var(--hover)] before:to-transparent motion-reduce:before:animate-none',
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

export type UiProgressTone = 'accent' | 'success' | 'warning' | 'danger';

const progressToneClassName: Record<UiProgressTone, string> = {
  accent: 'bg-[var(--accent)] shadow-[0_0_10px_-2px_var(--accent)]',
  success: 'bg-[var(--green)] shadow-[0_0_10px_-2px_var(--green)]',
  warning: 'bg-[var(--yellow)] shadow-[0_0_10px_-2px_var(--yellow)]',
  danger: 'bg-[var(--red)] shadow-[0_0_10px_-2px_var(--red)]',
};

export type UiProgressProps = {
  value?: number;
  max?: number;
  label: string;
  tone?: UiProgressTone;
  showValue?: boolean;
  className?: string;
};

export function UiProgress({
  value,
  max = 100,
  label,
  tone = 'accent',
  showValue = false,
  className,
}: UiProgressProps) {
  const determinate = typeof value === 'number' && Number.isFinite(value);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const clampedValue = determinate ? Math.min(safeMax, Math.max(0, value)) : 0;
  const percent = determinate ? (clampedValue / safeMax) * 100 : 35;
  return (
    <div className={cn('min-w-0', className)}>
      {(showValue || label) ? (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-[length:var(--text-10)] text-[var(--muted)]">
          <span className="truncate">{label}</span>
          {showValue && determinate ? <span className="shrink-0 font-mono">{Math.round(percent)}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? safeMax : undefined}
        aria-valuenow={determinate ? clampedValue : undefined}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-strong)] shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--shadow-color)_50%,transparent)]"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-200',
            progressToneClassName[tone],
            !determinate && 'animate-[progress-indeterminate_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export type UiToastProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: UiAlertTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
};

const toastRailClassName: Record<UiAlertTone, string> = {
  info: 'bg-[var(--info)]',
  success: 'bg-[var(--green)]',
  warning: 'bg-[var(--yellow)]',
  danger: 'bg-[var(--red)]',
};

export function UiToast({
  tone = 'info',
  title,
  description,
  action,
  onDismiss,
  className,
  ...props
}: UiToastProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'relative flex w-full max-w-[24rem] items-start gap-3 overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-overlay)] p-3 pl-4 shadow-[var(--edge-highlight),var(--shadow-toast)] backdrop-blur-md animate-toast-in motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', toastRailClassName[tone])}
      />
      <span className={cn(
        'mt-0.5 shrink-0',
        tone === 'info' && 'text-[var(--info)]',
        tone === 'success' && 'text-[var(--green)]',
        tone === 'warning' && 'text-[var(--yellow)]',
        tone === 'danger' && 'text-[var(--red)]',
      )}>
        <AlertIcon tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[length:var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>{title}</div>
        {description ? <div className="mt-0.5 text-[length:var(--text-10)] leading-relaxed text-[var(--muted)]">{description}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

export type UiEmptyStateProps = React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
};

export function UiEmptyState({ icon, title, description, action, className, ...props }: UiEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-5 py-6 text-center', className)} {...props}>
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-large)] border border-dashed border-[var(--border)] bg-[var(--surface-softest)] text-[var(--muted)] shadow-[var(--edge-highlight)]">
          {icon}
        </div>
      ) : null}
      <div className="text-[length:var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
        {title}
      </div>
      {description ? <div className="mt-1 max-w-[44ch] text-[length:var(--text-11)] leading-relaxed text-[var(--muted)]">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
