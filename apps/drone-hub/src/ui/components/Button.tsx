import * as React from 'react';
import { cn } from '../cn';
import { UiSpinner } from './Feedback';

export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type UiButtonSize = 'small' | 'medium' | 'large';

const variantClassName: Record<UiButtonVariant, string> = {
  primary:
    'border-[var(--accent-muted)] bg-[linear-gradient(180deg,var(--accent),var(--accent-muted))] text-[var(--accent-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_1px_3px_var(--shadow-color)] hover:brightness-[1.07] enabled:active:brightness-[.96]',
  secondary:
    'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--fg-secondary)] shadow-[var(--edge-highlight),var(--shadow-low)] hover:border-[var(--border)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)]',
  ghost:
    'border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
  danger:
    'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] shadow-[var(--edge-highlight)] hover:border-[var(--red)] hover:bg-[color-mix(in_srgb,var(--red-subtle)_78%,var(--red)_22%)] hover:shadow-[var(--edge-highlight),0_0_16px_-6px_var(--red)]',
};

const sizeClassName: Record<UiButtonSize, string> = {
  small: 'h-7 gap-1.5 rounded-[var(--radius-medium)] px-2.5 text-[length:var(--text-10)]',
  medium: 'h-[var(--control-height-compact)] gap-2 rounded-[var(--radius-medium)] px-3 text-[length:var(--text-11)]',
  large: 'h-[var(--control-height)] gap-2 rounded-[var(--radius-large)] px-4 text-[length:var(--text-12)]',
};

export type UiButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
};

export const UiButton = React.forwardRef<HTMLButtonElement, UiButtonProps>(function UiButton(
  {
    variant = 'secondary',
    size = 'medium',
    loading = false,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    disabled,
    className,
    children,
    type = 'button',
    style,
    ...props
  },
  ref,
) {
  const unavailable = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={unavailable}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border font-[var(--weight-semibold)] tracking-[0.01em] transition-[background-color,border-color,color,box-shadow,opacity,transform,filter] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:cursor-not-allowed enabled:active:translate-y-px',
        variantClassName[variant],
        sizeClassName[size],
        loading ? 'opacity-75' : disabled ? 'opacity-40' : null,
        fullWidth && 'w-full',
        className,
      )}
      style={{ fontFamily: 'var(--display)', ...style }}
      {...props}
    >
      {loading ? <UiSpinner size="small" label={null} inheritColor /> : leadingIcon}
      <span className="min-w-0 truncate">{children}</span>
      {trailingIcon}
    </button>
  );
});

export type UiIconButtonProps = Omit<UiButtonProps, 'children' | 'leadingIcon' | 'trailingIcon'> & {
  label: string;
  icon: React.ReactNode;
};

export const UiIconButton = React.forwardRef<HTMLButtonElement, UiIconButtonProps>(function UiIconButton(
  { label, icon, size = 'medium', title, className, ...props },
  ref,
) {
  const squareClassName =
    size === 'small' ? 'w-7 px-0' : size === 'large' ? 'w-[var(--control-height)] px-0' : 'w-[var(--control-height-compact)] px-0';
  return (
    <UiButton
      ref={ref}
      size={size}
      aria-label={label}
      title={title ?? label}
      className={cn(squareClassName, className)}
      {...props}
    >
      <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
    </UiButton>
  );
});
