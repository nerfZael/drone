import React from 'react';
import { cn } from '../../ui/cn';

type HeaderActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const HeaderActionButton = React.forwardRef<HTMLButtonElement, HeaderActionButtonProps>(
  function HeaderActionButton(
    { disabled = false, className, children, type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        data-unavailable={disabled ? 'true' : undefined}
        className={cn(
          'inline-flex items-center gap-1.5 rounded border px-2 py-1 dh-type-header-action transition-all',
          disabled
            ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] opacity-40'
            : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:border-[var(--border)]',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
