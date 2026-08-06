import * as React from 'react';
import { Dialog } from 'radix-ui';
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
  const panelClassName = cn(
    'fixed left-1/2 top-1/2 z-[121] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-xlarge)] border bg-[var(--panel-overlay)] shadow-[var(--edge-highlight),var(--shadow-dialog)] animate-dialog-in focus:outline-none motion-reduce:animate-none',
    sizeClassName[size],
    toneClassName[tone],
    className,
  );
  const panelContents = (
    <>
      <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] bg-[linear-gradient(180deg,var(--surface-softest),transparent)] px-5 py-4">
          {icon ? (
            <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-large)] border', iconToneClassName[tone])}>
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            {eyebrow ? <div className="dh-type-eyebrow">{eyebrow}</div> : null}
            <Dialog.Title asChild>
              <h2 className={cn('text-[17px] font-medium leading-6 text-[var(--fg-strong)]', Boolean(eyebrow) && 'mt-1')}>
                {title}
              </h2>
            </Dialog.Title>
            {description ? (
              <Dialog.Description asChild>
                <p className="mt-1 dh-type-supporting !text-[var(--muted)]">{description}</p>
              </Dialog.Description>
            ) : null}
          </div>
          {showCloseButton ? (
            <Dialog.Close asChild disabled={!dismissible}>
              <UiIconButton
                label="Close dialog"
                icon={<CloseIcon />}
                variant="ghost"
                size="small"
                disabled={!dismissible}
                className="-mr-1 -mt-0.5"
              />
            </Dialog.Close>
          ) : null}
      </div>
      {children ? <div className={cn('px-5 py-4', bodyClassName)}>{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-3.5">
          {footer}
        </div>
      ) : null}
    </>
  );

  if (!open) return null;
  if (!globalThis.document?.body) {
    return (
      <Dialog.Root open onOpenChange={(nextOpen) => !nextOpen && dismissible && onClose()}>
        <div className="fixed inset-0 z-[120] bg-[var(--scrim)] backdrop-blur-sm animate-overlay-in motion-reduce:animate-none" />
        <div role="dialog" aria-modal="true" className={panelClassName}>
          {panelContents}
        </div>
      </Dialog.Root>
    );
  }

  const dialog = (
    <>
      <Dialog.Overlay className="fixed inset-0 z-[120] bg-[var(--scrim)] backdrop-blur-sm animate-overlay-in motion-reduce:animate-none" />
      <Dialog.Content
        aria-modal="true"
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={(event) => {
          if (!initialFocusRef?.current) return;
          event.preventDefault();
          initialFocusRef.current.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (!dismissible) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!dismissible) event.preventDefault();
        }}
        className={panelClassName}
      >
        {panelContents}
      </Dialog.Content>
    </>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && dismissible && onClose()}>
      <Dialog.Portal>{dialog}</Dialog.Portal>
    </Dialog.Root>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
