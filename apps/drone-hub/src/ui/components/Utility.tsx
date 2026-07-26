import * as React from 'react';
import { cn } from '../cn';

export function UiKbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.5rem] items-center justify-center rounded-[4px] border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 font-mono text-[length:var(--text-9)] font-[var(--weight-semibold)] leading-none text-[var(--fg-secondary)] shadow-[inset_0_-1px_0_var(--border)]',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

export type UiTooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement<any>;
  side?: 'top' | 'bottom';
  className?: string;
};

export function UiTooltip({ content, children, side = 'top', className }: UiTooltipProps) {
  const tooltipId = React.useId();
  const describedBy = [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' ');
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {React.cloneElement(children, { 'aria-describedby': describedBy })}
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-[150] w-max max-w-[16rem] -translate-x-1/2 rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-raised)] px-2 py-1 text-center text-[length:var(--text-9)] leading-relaxed text-[var(--fg-secondary)] opacity-0 shadow-[0_8px_24px_var(--shadow-color)] transition-opacity group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          side === 'top' ? 'bottom-[calc(100%+0.4rem)]' : 'top-[calc(100%+0.4rem)]',
        )}
      >
        {content}
      </span>
    </span>
  );
}
