import * as React from 'react';
import { cn } from '../cn';
import { UiSpinner } from './Feedback';

export type UiPaneStateKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'warning'
  | 'offline'
  | 'unavailable';

const kindClassName: Record<UiPaneStateKind, string> = {
  loading: 'text-[var(--accent)]',
  empty: 'text-[var(--muted)]',
  error: 'text-[var(--red)]',
  warning: 'text-[var(--yellow)]',
  offline: 'text-[var(--muted-dim)]',
  unavailable: 'text-[var(--muted-dim)]',
};

function StateGlyph({ kind }: { kind: Exclude<UiPaneStateKind, 'loading'> }) {
  if (kind === 'error' || kind === 'warning') {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M10 2.4 18 17H2L10 2.4Z" stroke="currentColor" strokeWidth="1.35" />
        <path d="M10 7v4.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r=".8" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.35" />
      {kind === 'offline' ? (
        <path d="m5 5 10 10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      ) : (
        <>
          <path d="M7 10h6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          <path d="M10 7v6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export type UiPaneStateProps = React.HTMLAttributes<HTMLDivElement> & {
  kind: UiPaneStateKind;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  compact?: boolean;
};

export function UiPaneState({
  kind,
  title,
  description,
  action,
  icon,
  compact = false,
  className,
  ...props
}: UiPaneStateProps) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex min-h-0 min-w-0 flex-col items-center justify-center text-center',
        compact ? 'px-3 py-4' : 'h-full px-6 py-8',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] shadow-[var(--edge-highlight)]',
          compact ? 'h-8 w-8' : 'h-10 w-10',
          kindClassName[kind],
        )}
      >
        {icon ?? (kind === 'loading' ? <UiSpinner label={null} inheritColor /> : <StateGlyph kind={kind} />)}
      </div>
      <div
        className={cn(
          'font-[var(--weight-semibold)] text-[var(--fg-secondary)]',
          compact ? 'mt-2 text-[length:var(--text-10)]' : 'mt-3 text-[length:var(--text-12)]',
        )}
        style={{ fontFamily: 'var(--display)' }}
      >
        {title}
      </div>
      {description ? (
        <div
          className={cn(
            'mt-1 max-w-[44ch] leading-relaxed text-[var(--muted)]',
            compact ? 'text-[length:var(--text-9)]' : 'text-[length:var(--text-11)]',
          )}
        >
          {description}
        </div>
      ) : null}
      {action ? <div className={compact ? 'mt-2' : 'mt-3'}>{action}</div> : null}
    </div>
  );
}
