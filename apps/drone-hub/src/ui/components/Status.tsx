import * as React from 'react';
import { cn } from '../cn';

export type UiStatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const statusColorClassName: Record<UiStatusTone, string> = {
  neutral: 'text-[var(--muted-dim)]',
  accent: 'text-[var(--accent)]',
  success: 'text-[var(--green)]',
  warning: 'text-[var(--yellow)]',
  danger: 'text-[var(--red)]',
  info: 'text-[var(--info)]',
};

const statusChipClassName: Record<UiStatusTone, string> = {
  neutral: 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]',
  accent: 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]',
  success: 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]',
  warning: 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
  danger: 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]',
  info: 'border-[var(--info-border)] bg-[var(--info-subtle)] text-[var(--info)]',
};

export type UiStatusDotProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: UiStatusTone;
  pulse?: boolean;
  label?: string;
};

export function UiStatusDot({
  tone = 'neutral',
  pulse = false,
  label,
  className,
  ...props
}: UiStatusDotProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      className={cn('relative inline-flex h-2 w-2 shrink-0', statusColorClassName[tone], className)}
      {...props}
    >
      {pulse ? (
        <span
          className="absolute inset-0 animate-ping rounded-full bg-current opacity-35 motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : null}
      <span className="relative h-2 w-2 rounded-full bg-current shadow-[0_0_6px_currentColor]" aria-hidden="true" />
    </span>
  );
}

export type UiStatusChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: UiStatusTone;
  dot?: boolean;
};

export function UiStatusChip({
  tone = 'neutral',
  dot = false,
  className,
  children,
  style,
  ...props
}: UiStatusChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 dh-type-badge',
        statusChipClassName[tone],
        className,
      )}
      style={style}
      {...props}
    >
      {dot ? <UiStatusDot tone={tone} className="h-1.5 w-1.5 [&>span]:h-1.5 [&>span]:w-1.5" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function UiCountBadge({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--surface-strong)] px-1 font-mono text-[length:var(--text-11)] tabular-nums text-[var(--muted)]',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
