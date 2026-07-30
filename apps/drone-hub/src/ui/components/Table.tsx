import * as React from 'react';
import { cn } from '../cn';

export function UiTableContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-faint)] shadow-[var(--edge-highlight),var(--shadow-low)]',
        className,
      )}
      {...props}
    />
  );
}

export function UiTable({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left text-[length:var(--text-11)]', className)} {...props} />;
}

export function UiTableHead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-[var(--surface-inset)] text-[var(--muted-dim)]', className)} {...props} />;
}

export function UiTableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-[var(--border-subtle)]', className)} {...props} />;
}

export function UiTableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors duration-100 hover:bg-[var(--surface-soft)]', className)} {...props} />;
}

export function UiTableHeaderCell({ className, style, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-[var(--border-subtle)] px-3 py-2 text-[length:var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em]',
        className,
      )}
      style={{ fontFamily: 'var(--display)', ...style }}
      {...props}
    />
  );
}

export function UiTableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 text-[var(--fg-secondary)]', className)} {...props} />;
}
