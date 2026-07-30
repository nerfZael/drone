import * as React from 'react';
import { cn } from '../cn';

export type UiCardSurface = 'default' | 'raised' | 'inset';
export type UiCardPadding = 'none' | 'small' | 'medium' | 'large';

const surfaceClassName: Record<UiCardSurface, string> = {
  default: 'bg-[var(--surface-softest)] shadow-[var(--edge-highlight)]',
  raised: 'bg-[var(--panel-raised)] shadow-[var(--edge-highlight),var(--shadow-raised)]',
  inset: 'bg-[var(--surface-inset)] shadow-[inset_0_1px_3px_color-mix(in_srgb,var(--shadow-color)_45%,transparent)]',
};

const paddingClassName: Record<UiCardPadding, string> = {
  none: '',
  small: 'p-3',
  medium: 'p-4',
  large: 'p-5',
};

export type UiCardProps = React.HTMLAttributes<HTMLDivElement> & {
  surface?: UiCardSurface;
  padding?: UiCardPadding;
  interactive?: boolean;
};

export const UiCard = React.forwardRef<HTMLDivElement, UiCardProps>(function UiCard(
  { surface = 'default', padding = 'medium', interactive = false, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[var(--radius-large)] border border-[var(--border-subtle)]',
        surfaceClassName[surface],
        paddingClassName[padding],
        interactive &&
          'transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[var(--border)] hover:bg-[var(--surface-soft)] hover:shadow-[var(--edge-highlight),var(--shadow-raised)] motion-reduce:transform-none',
        className,
      )}
      {...props}
    />
  );
});

export type UiCardHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
};

export function UiCardHeader({
  eyebrow,
  title,
  description,
  action,
  className,
  ...props
}: UiCardHeaderProps) {
  return (
    <div className={cn('flex min-w-0 items-start justify-between gap-4', className)} {...props}>
      <div className="min-w-0">
        {eyebrow ? (
          <div
            className="mb-1 text-[length:var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.1em] text-[var(--muted-dim)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div
          className="text-[length:var(--text-14)] font-[var(--weight-semibold)] leading-5 text-[var(--fg-strong)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          {title}
        </div>
        {description ? (
          <div className="mt-1 text-[length:var(--text-11)] leading-relaxed text-[var(--muted)]">{description}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function UiCardDivider({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('my-4 border-0 border-t border-[var(--border-subtle)]', className)} {...props} />;
}
