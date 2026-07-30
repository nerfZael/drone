import * as React from 'react';
import { cn } from '../cn';

export type UiBadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneClassName: Record<UiBadgeTone, string> = {
  neutral: 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]',
  accent: 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]',
  success: 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]',
  warning: 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
  danger: 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]',
  info: 'border-[var(--info-border)] bg-[var(--info-subtle)] text-[var(--info)]',
};

export type UiBadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: UiBadgeTone;
  dot?: boolean;
};

export function UiBadge({ tone = 'neutral', dot = false, className, children, style, ...props }: UiBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1.5 rounded-full border px-2 text-[length:var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] shadow-[var(--edge-highlight)]',
        toneClassName[tone],
        className,
      )}
      style={{ fontFamily: 'var(--display)', ...style }}
      {...props}
    >
      {dot ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current shadow-[0_0_5px_currentColor]"
          aria-hidden="true"
        />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
