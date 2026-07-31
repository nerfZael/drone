import * as React from 'react';
import { cn } from '../cn';

export type UiCardSurface = 'default' | 'raised' | 'inset';
export type UiCardPadding = 'none' | 'small' | 'medium' | 'large';

const surfaceClassName: Record<UiCardSurface, string> = {
  default: 'bg-transparent',
  raised:
    'rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-raised)] shadow-[var(--edge-highlight),var(--shadow-raised)]',
  inset: 'rounded-[var(--radius-large)] bg-[var(--surface-inset)]',
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
        surfaceClassName[surface],
        paddingClassName[padding],
        interactive &&
          'rounded-[var(--radius-medium)] transition-[background-color,color] duration-150 hover:bg-[var(--hover)]',
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
          <div className="mb-1 dh-type-eyebrow">
            {eyebrow}
          </div>
        ) : null}
        <div className="dh-type-heading">
          {title}
        </div>
        {description ? (
          <div className="mt-1 dh-type-supporting !text-[var(--muted)]">{description}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function UiCardDivider({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('my-4 border-0 border-t border-[var(--border-subtle)]', className)} {...props} />;
}
