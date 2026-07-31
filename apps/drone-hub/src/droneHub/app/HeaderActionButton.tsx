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
          'inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-medium)] border border-transparent bg-transparent px-2.5 dh-type-header-action transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
          disabled
            ? 'cursor-not-allowed opacity-40'
            : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
