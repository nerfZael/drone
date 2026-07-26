import * as React from 'react';
import { cn } from '../cn';
import { UiIconButton } from './Button';

export type UiDialogSize = 'small' | 'medium' | 'large';
export type UiDialogTone = 'neutral' | 'accent' | 'danger';

const sizeClassName: Record<UiDialogSize, string> = {
  small: 'max-w-[27rem]',
  medium: 'max-w-[36rem]',
  large: 'max-w-[48rem]',
};

const toneClassName: Record<UiDialogTone, string> = {
  neutral: 'border-[var(--border)]',
  accent: 'border-[var(--accent-border)]',
  danger: 'border-[var(--red-border)]',
};

const iconToneClassName: Record<UiDialogTone, string> = {
  neutral: 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]',
  accent: 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]',
  danger: 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]',
};

const focusableSelector =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export type UiDialogProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: UiDialogSize;
  tone?: UiDialogTone;
  dismissible?: boolean;
  showCloseButton?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
};

export function UiDialog({
  open,
  onClose,
  title,
  description,
  eyebrow,
  icon,
  children,
  footer,
  size = 'medium',
  tone = 'neutral',
  dismissible = true,
  showCloseButton = true,
  initialFocusRef,
  className,
  bodyClassName,
}: UiDialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>(focusableSelector) ??
        panelRef.current;
      target?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, [initialFocusRef, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--scrim)] px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && dismissible) {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
        if (!focusable?.length) {
          event.preventDefault();
          panelRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'w-full overflow-hidden rounded-[var(--radius-xlarge)] border bg-[var(--panel-overlay)] shadow-[0_24px_80px_var(--shadow-color)] animate-slide-up focus:outline-none motion-reduce:animate-none',
          sizeClassName[size],
          toneClassName[tone],
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          {icon ? (
            <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-large)] border', iconToneClassName[tone])}>
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <div className="text-[length:var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                {eyebrow}
              </div>
            ) : null}
            <h2
              id={titleId}
              className={cn('text-[17px] font-[var(--weight-semibold)] leading-6 text-[var(--fg-strong)]', Boolean(eyebrow) && 'mt-1')}
              style={{ fontFamily: 'var(--display)' }}
            >
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-[length:var(--text-11)] leading-relaxed text-[var(--muted)]">
                {description}
              </p>
            ) : null}
          </div>
          {showCloseButton ? (
            <UiIconButton
              label="Close dialog"
              icon={<CloseIcon />}
              variant="ghost"
              size="small"
              disabled={!dismissible}
              onClick={onClose}
              className="-mr-1 -mt-0.5"
            />
          ) : null}
        </div>
        {children ? <div className={cn('px-5 py-4', bodyClassName)}>{children}</div> : null}
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
