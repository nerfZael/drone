import * as React from 'react';
import { cn } from '../cn';

export function UiKbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.5rem] items-center justify-center rounded-[4px] border border-[var(--border)] bg-[linear-gradient(180deg,var(--surface-strong),var(--surface-inset))] px-1.5 py-0.5 font-mono text-[length:var(--text-9)] font-[var(--weight-semibold)] leading-none text-[var(--fg-secondary)] shadow-[var(--edge-highlight),0_1.5px_0_var(--border),0_2px_3px_-1px_var(--shadow-color)]',
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
          'pointer-events-none absolute left-1/2 z-[150] w-max max-w-[16rem] -translate-x-1/2 rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-overlay)] px-2 py-1 text-center text-[length:var(--text-9)] leading-relaxed text-[var(--fg-secondary)] opacity-0 shadow-[var(--edge-highlight),var(--shadow-menu)] backdrop-blur-md transition-[opacity,transform] duration-150 group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100 group-hover/tooltip:delay-300 group-focus-within/tooltip:translate-y-0 group-focus-within/tooltip:opacity-100',
          side === 'top'
            ? 'bottom-[calc(100%+0.45rem)] translate-y-0.5'
            : 'top-[calc(100%+0.45rem)] -translate-y-0.5',
        )}
      >
        {content}
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-[var(--panel-overlay)]',
            side === 'top'
              ? '-bottom-[3.5px] border-b border-r border-[var(--border)]'
              : '-top-[3.5px] border-l border-t border-[var(--border)]',
          )}
        />
      </span>
    </span>
  );
}
